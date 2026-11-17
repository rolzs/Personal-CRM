// Apple Intelligence bridge for Personal CRM.
//
// One C entry point, `crm_ai_call(op, json) -> json`, called from Rust
// (src-tauri/src/ai.rs) on a background thread. Every answer is a JSON object
// with either `"ok": true` and the result, or `"ok": false, "error": <code>`.
//
// Ops: availability, probe_cloud, summarize, next_step, extract_contacts.
//
// Models: the on-device model (macOS 26+) is used by default. Apple's larger
// Private Cloud Compute model (macOS 27+) is used only when the request allows
// it ("allow_cloud") and the local model can't do the job: it is unavailable,
// the input is too long for it, or the answer language isn't supported locally.
// Without Apple's managed entitlement every cloud call fails; that failure is
// caught and the local model is used instead.
//
// Structured answers use DynamicGenerationSchema (the @Generable macro needs
// full Xcode, which this project does not require).

import Foundation
#if canImport(FoundationModels) && arch(arm64)
import FoundationModels
#endif

// MARK: - C ABI

@_cdecl("crm_ai_call")
public func crmAiCall(_ op: UnsafePointer<CChar>, _ input: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    let opName = String(cString: op)
    let inputData = Data(String(cString: input).utf8)
    let request = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]

    // Foundation Models is async; this function is always called off the main thread.
    let box = ResultBox()
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached {
        box.value = await dispatch(op: opName, request: request)
        semaphore.signal()
    }
    semaphore.wait()
    return strdup(encode(box.value))
}

@_cdecl("crm_ai_free")
public func crmAiFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}

private final class ResultBox: @unchecked Sendable {
    var value: [String: Any] = [:]
}

private func encode(_ object: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let text = String(data: data, encoding: .utf8) else {
        return #"{"ok":false,"error":"encoding_failed"}"#
    }
    return text
}

private func failure(_ code: String, _ detail: String = "") -> [String: Any] {
    ["ok": false, "error": code, "detail": detail]
}

private func dispatch(op: String, request: [String: Any]) async -> [String: Any] {
    #if canImport(FoundationModels) && arch(arm64)
    if #available(macOS 26.0, *) {
        return await Intelligence.handle(op: op, request: request)
    }
    #endif
    if op == "availability" {
        return ["ok": true, "local": ["available": false, "reason": "unsupported_os", "languages": [String]()],
                "cloud": ["available": false, "reason": "unsupported_os"]]
    }
    return failure("unavailable", "unsupported_os")
}

#if canImport(FoundationModels) && arch(arm64)

// MARK: - Implementation (macOS 26+)

@available(macOS 26.0, *)
enum Intelligence {
    static func handle(op: String, request: [String: Any]) async -> [String: Any] {
        let allowCloud = request["allow_cloud"] as? Bool ?? false
        let lang = request["lang"] as? String ?? "en"
        switch op {
        case "availability": return await availability()
        case "probe_cloud": return await probeCloud()
        case "summarize": return await summarize(request, lang: lang, allowCloud: allowCloud)
        case "next_step": return await nextStep(request, lang: lang, allowCloud: allowCloud)
        case "extract_contacts": return await extractContacts(request, allowCloud: allowCloud)
        default: return failure("unknown_op", op)
        }
    }

    // MARK: Availability

    static func localLanguages() -> [String] {
        Array(Set(SystemLanguageModel.default.supportedLanguages.compactMap { $0.languageCode?.identifier })).sorted()
    }

    static func localReason() -> String? {
        switch SystemLanguageModel.default.availability {
        case .available: return nil
        case .unavailable(.deviceNotEligible): return "device_not_eligible"
        case .unavailable(.appleIntelligenceNotEnabled): return "not_enabled"
        case .unavailable(.modelNotReady): return "model_not_ready"
        case .unavailable: return "unavailable"
        }
    }

    static func availability() async -> [String: Any] {
        let reason = localReason()
        var local: [String: Any] = ["available": reason == nil, "languages": localLanguages()]
        if let reason { local["reason"] = reason }
        return ["ok": true, "local": local, "cloud": cloudStatus()]
    }

    static func cloudStatus() -> [String: Any] {
        if #available(macOS 27.0, *) {
            let model = PrivateCloudComputeLanguageModel()
            switch model.availability {
            case .available:
                if case .limitReached = model.quotaUsage.status {
                    return ["available": false, "reason": "quota_reached"]
                }
                return ["available": true]
            case .unavailable(.deviceNotEligible): return ["available": false, "reason": "device_not_eligible"]
            case .unavailable(.systemNotReady): return ["available": false, "reason": "system_not_ready"]
            case .unavailable: return ["available": false, "reason": "unavailable"]
            }
        }
        return ["available": false, "reason": "unsupported_os"]
    }

    /// A tiny real request: the cloud model reports "available" even when this
    /// app lacks Apple's entitlement, and only an actual call tells.
    static func probeCloud() async -> [String: Any] {
        if #available(macOS 27.0, *) {
            guard cloudStatus()["available"] as? Bool == true else {
                return failure("cloud_unavailable", cloudStatus()["reason"] as? String ?? "")
            }
            do {
                _ = try await LanguageModelSession(model: PrivateCloudComputeLanguageModel()).respond(to: "Reply with OK.")
                return ["ok": true]
            } catch {
                return failure(cloudErrorCode(error), "\(error)")
            }
        }
        return failure("cloud_unavailable", "unsupported_os")
    }

    // MARK: Model selection

    static func languageName(_ code: String) -> String {
        Locale(identifier: "en").localizedString(forLanguageCode: code) ?? "English"
    }

    struct Answer {
        let content: GeneratedContent
        let model: String  // "local" | "cloud"
        let language: String  // language actually requested from the model
        let cloudError: String?
    }

    /// Run one structured request, choosing between the local and cloud model.
    /// `instructions` gets the answer language's English name.
    static func respond(
        instructions: (String) -> String,
        prompt: String,
        schema: GenerationSchema,
        wantLanguage: String,
        allowCloud: Bool
    ) async throws -> Answer {
        let localAvailable = localReason() == nil
        let localSpeaks = localLanguages().contains(wantLanguage)
        var cloudError: String?

        func viaCloud(_ language: String) async throws -> Answer? {
            guard allowCloud else { return nil }
            if #available(macOS 27.0, *) {
                guard cloudStatus()["available"] as? Bool == true else { return nil }
                do {
                    let session = LanguageModelSession(model: PrivateCloudComputeLanguageModel(),
                                                       instructions: instructions(languageName(language)))
                    let response = try await session.respond(to: prompt, schema: schema)
                    return Answer(content: response.content, model: "cloud", language: language, cloudError: nil)
                } catch {
                    cloudError = cloudErrorCode(error)
                    return nil
                }
            }
            return nil
        }

        // The cloud is only worth it when the local model can't do the job.
        if !localAvailable || !localSpeaks, let answer = try await viaCloud(wantLanguage) {
            return answer
        }
        guard localAvailable else {
            throw AIError(code: "unavailable", detail: localReason() ?? "")
        }
        let language = localSpeaks ? wantLanguage : "en"
        do {
            let session = LanguageModelSession(instructions: instructions(languageName(language)))
            let response = try await session.respond(to: prompt, schema: schema)
            return Answer(content: response.content, model: "local", language: language, cloudError: cloudError)
        } catch let error as LanguageModelSession.GenerationError {
            if case .exceededContextWindowSize = error, let answer = try await viaCloud(wantLanguage) {
                return answer
            }
            throw AIError(code: generationErrorCode(error), detail: "\(error)")
        }
    }

    struct AIError: Error {
        let code: String
        let detail: String
    }

    static func generationErrorCode(_ error: LanguageModelSession.GenerationError) -> String {
        switch error {
        case .exceededContextWindowSize: return "too_long"
        case .guardrailViolation, .refusal: return "refused"
        case .assetsUnavailable: return "model_not_ready"
        case .unsupportedLanguageOrLocale: return "unsupported_language"
        case .rateLimited: return "rate_limited"
        case .decodingFailure, .unsupportedGuide: return "bad_output"
        default: return "failed"
        }
    }

    static func cloudErrorCode(_ error: Error) -> String {
        if #available(macOS 27.0, *), let cloud = error as? PrivateCloudComputeLanguageModel.Error {
            switch cloud {
            case .networkFailure: return "cloud_network"
            case .quotaLimitReached: return "cloud_quota"
            case .serviceUnavailable: return "cloud_unavailable"
            default: return "cloud_failed"
            }
        }
        // What a missing entitlement looks like (ModelManagerError 1046 wrapped in LanguageModelError -1).
        let ns = error as NSError
        if ns.domain.contains("LanguageModelError") { return "cloud_not_entitled" }
        return "cloud_failed"
    }

    static func run(_ body: () async throws -> [String: Any]) async -> [String: Any] {
        do {
            return try await body()
        } catch let error as AIError {
            return failure(error.code, error.detail)
        } catch let error as LanguageModelSession.GenerationError {
            return failure(generationErrorCode(error), "\(error)")
        } catch {
            return failure("failed", "\(error)")
        }
    }

    static func string(_ content: GeneratedContent, _ key: String) -> String {
        ((try? content.value(String.self, forProperty: key)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func meta(_ answer: Answer) -> [String: Any] {
        var out: [String: Any] = ["ok": true, "model": answer.model, "language": answer.language]
        if let e = answer.cloudError { out["cloud_error"] = e }
        return out
    }

    static func prop(_ name: String, _ description: String) -> DynamicGenerationSchema.Property {
        .init(name: name, description: description, schema: .init(type: String.self))
    }

    // MARK: Ops

    /// "Where things stand" for one contact + one suggested next step.
    static func summarize(_ request: [String: Any], lang: String, allowCloud: Bool) async -> [String: Any] {
        await run {
            let context = request["context"] as? String ?? ""
            let schema = try GenerationSchema(root: DynamicGenerationSchema(name: "ContactSummary", properties: [
                prop("summary", "2-4 short sentences: who this is, what was discussed, current status, open questions."),
                prop("next_step", "One concrete next action for the user, or an empty string if none is needed."),
            ]), dependencies: [])
            let answer = try await respond(
                instructions: { language in
                    """
                    You help a salesperson keep track of business contacts in a personal CRM.
                    Use only facts from the provided contact record; never invent names, numbers or dates.
                    The record may be in Latvian or English. Write your answer in \(language).
                    """
                },
                prompt: "Summarize this contact record.\n\n\(context)",
                schema: schema, wantLanguage: lang, allowCloud: allowCloud)
            var out = meta(answer)
            out["summary"] = string(answer.content, "summary")
            out["next_step"] = string(answer.content, "next_step")
            return out
        }
    }

    /// One follow-up reminder after an activity was logged. `when` is an English
    /// phrase ("tomorrow 10:00", "in 3 days", "next week", "friday") that the
    /// app's own quick-add parser turns into a date.
    static func nextStep(_ request: [String: Any], lang: String, allowCloud: Bool) async -> [String: Any] {
        await run {
            let context = request["context"] as? String ?? ""
            let activity = request["activity"] as? String ?? ""
            let today = request["today"] as? String ?? ""
            let schema = try GenerationSchema(root: DynamicGenerationSchema(name: "FollowUp", properties: [
                prop("title", "Short reminder title starting with a verb, e.g. 'Send offer to Dmitrijs'. Max 60 characters."),
                prop("when", "When to do it, as an English phrase: 'today 15:00', 'tomorrow', 'tomorrow 10:00', 'in 3 days', 'next week', 'friday', 'next week monday'."),
            ]), dependencies: [])
            let answer = try await respond(
                instructions: { language in
                    """
                    You suggest the single most useful follow-up reminder for a salesperson's CRM.
                    Today is \(today). Base the timing on what the activity says (e.g. 'next week', 'after the board meeting');
                    if nothing is said, pick a sensible time within a week.
                    Use only facts from the given text. Write the title in \(language). The 'when' field is always English.
                    """
                },
                prompt: "Contact:\n\(context)\n\nActivity just logged:\n\(activity)",
                schema: schema, wantLanguage: lang, allowCloud: allowCloud)
            var out = meta(answer)
            out["title"] = string(answer.content, "title")
            out["when"] = string(answer.content, "when")
            return out
        }
    }

    /// People found in pasted text (email signatures, "Responsible person" cells…).
    static func extractContacts(_ request: [String: Any], allowCloud: Bool) async -> [String: Any] {
        await run {
            let text = request["text"] as? String ?? ""
            let person = DynamicGenerationSchema(name: "Person", properties: [
                prop("name", "Full name of the person exactly as written (keep Latvian letters like ā, č, ņ). Empty if only a department is given."),
                prop("title", "Job title or role as written, or empty."),
                prop("company", "Company name only if it is written out as a name in the text; never derive it from an email address or website. Otherwise empty."),
                prop("email", "Email address exactly as written, or empty."),
                prop("phone", "Main phone number exactly as written, or empty."),
            ])
            let schema = try GenerationSchema(root: DynamicGenerationSchema(name: "People", properties: [
                .init(name: "people", description: "Every distinct person in the text, in order.",
                      schema: DynamicGenerationSchema(arrayOf: person)),
            ]), dependencies: [])
            let answer = try await respond(
                instructions: { _ in
                    """
                    You extract contact details from pasted text for a CRM.
                    Copy values exactly as they appear; never invent or reformat names, emails or phone numbers.
                    One entry per person. Leave a field empty when the text does not contain it.
                    """
                },
                prompt: text, schema: schema, wantLanguage: "en", allowCloud: allowCloud)
            var out = meta(answer)
            let people = (try? answer.content.value([GeneratedContent].self, forProperty: "people")) ?? []
            out["people"] = people.map { p in
                ["name": string(p, "name"), "title": string(p, "title"), "company": string(p, "company"),
                 "email": string(p, "email"), "phone": string(p, "phone")]
            }
            return out
        }
    }
}
#endif

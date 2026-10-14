import Foundation
import Capacitor
import HealthKit
import EventKit
import WebKit
import CryptoKit

/// Lifedash's own native bridge: HealthKit (Garmin/WHOOP/Apple Watch data),
/// EventKit (all calendar accounts on the iPhone) and isolated, persistent
/// WKWebViews for embedded web apps (WhatsApp Web, mail, …).
@objc(LifeNativePlugin)
public class LifeNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LifeNativePlugin"
    public let jsName = "LifeNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "healthAuthorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthDays", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthHeartRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarAuthorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openMiniApp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearMiniApp", returnType: CAPPluginReturnPromise),
    ]

    private let health = HKHealthStore()
    private let events = EKEventStore()
    private var miniApps: [String: MiniAppController] = [:]

    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func date(_ call: CAPPluginCall, _ key: String) -> Date? {
        guard let s = call.getString(key) else { return nil }
        return iso.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    private func dayKey(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    // MARK: - HealthKit

    private var readTypes: Set<HKObjectType> {
        var s: Set<HKObjectType> = [HKObjectType.workoutType()]
        let q: [HKQuantityTypeIdentifier] = [.stepCount, .activeEnergyBurned, .restingHeartRate, .heartRateVariabilitySDNN, .oxygenSaturation, .vo2Max, .heartRate]
        q.compactMap { HKObjectType.quantityType(forIdentifier: $0) }.forEach { s.insert($0) }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { s.insert(sleep) }
        return s
    }

    @objc func healthAuthorize(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { return call.resolve(["granted": false]) }
        health.requestAuthorization(toShare: nil, read: readTypes) { ok, _ in
            // iOS never reveals whether *read* access was granted; `ok` means the sheet was handled.
            call.resolve(["granted": ok])
        }
    }

    private func dailyStats(_ id: HKQuantityTypeIdentifier, unit: HKUnit, options: HKStatisticsOptions, start: Date, end: Date, scale: Double = 1, completion: @escaping ([String: Double]) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: id) else { return completion([:]) }
        let anchor = Calendar.current.startOfDay(for: start)
        let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end), options: options, anchorDate: anchor, intervalComponents: DateComponents(day: 1))
        q.initialResultsHandler = { [weak self] _, results, _ in
            var out: [String: Double] = [:]
            results?.enumerateStatistics(from: start, to: end) { stats, _ in
                let qty = options.contains(.cumulativeSum) ? stats.sumQuantity() : (options.contains(.mostRecent) ? stats.mostRecentQuantity() : stats.averageQuantity())
                if let v = qty?.doubleValue(for: unit), let self = self { out[self.dayKey(stats.startDate)] = v * scale }
            }
            completion(out)
        }
        health.execute(q)
    }

    private struct SleepNight {
        var asleep = 0.0, deep = 0.0, rem = 0.0
        var start: Date?, end: Date?
    }

    /// Sleep per night, attributed to the day it ends on. When several apps/watches
    /// write the same night, only the source with the most recorded sleep is used.
    private func sleep(start: Date, end: Date, completion: @escaping ([String: SleepNight]) -> Void) {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return completion([:]) }
        let pred = HKQuery.predicateForSamples(withStart: start.addingTimeInterval(-14 * 3600), end: end)
        let q = HKSampleQuery(sampleType: type, predicate: pred, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, samples, _ in
            guard let self = self else { return completion([:]) }
            var bySource: [String: [String: SleepNight]] = [:]
            for case let s as HKCategorySample in samples ?? [] {
                guard let v = HKCategoryValueSleepAnalysis(rawValue: s.value) else { continue }
                let mins = s.endDate.timeIntervalSince(s.startDate) / 60
                let day = self.dayKey(s.endDate)
                let src = s.sourceRevision.source.bundleIdentifier
                var n = bySource[day, default: [:]][src] ?? SleepNight()
                switch v {
                case .asleepDeep: n.asleep += mins; n.deep += mins
                case .asleepREM: n.asleep += mins; n.rem += mins
                case .asleepCore, .asleepUnspecified: n.asleep += mins
                default: break
                }
                if v != .inBed && v != .awake {
                    n.start = min(n.start ?? s.startDate, s.startDate)
                    n.end = max(n.end ?? s.endDate, s.endDate)
                }
                bySource[day, default: [:]][src] = n
            }
            var out: [String: SleepNight] = [:]
            for (day, sources) in bySource {
                if let best = sources.values.max(by: { $0.asleep < $1.asleep }), best.asleep > 0 { out[day] = best }
            }
            completion(out)
        }
        health.execute(q)
    }

    @objc func healthDays(_ call: CAPPluginCall) {
        guard let start = date(call, "start"), let end = date(call, "end") else { return call.reject("start/end required") }
        let group = DispatchGroup()
        let lock = NSLock()
        var fields: [String: [String: Double]] = [:]
        var nights: [String: SleepNight] = [:]
        func collect(_ key: String) -> ([String: Double]) -> Void {
            group.enter()
            return { r in lock.lock(); fields[key] = r; lock.unlock(); group.leave() }
        }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        dailyStats(.stepCount, unit: .count(), options: .cumulativeSum, start: start, end: end, completion: collect("steps"))
        dailyStats(.activeEnergyBurned, unit: .kilocalorie(), options: .cumulativeSum, start: start, end: end, completion: collect("activeKcal"))
        dailyStats(.restingHeartRate, unit: bpm, options: .discreteAverage, start: start, end: end, completion: collect("restingHr"))
        dailyStats(.heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), options: .discreteAverage, start: start, end: end, completion: collect("hrvMs"))
        dailyStats(.oxygenSaturation, unit: .percent(), options: .discreteAverage, start: start, end: end, scale: 100, completion: collect("spo2"))
        dailyStats(.vo2Max, unit: HKUnit(from: "ml/kg*min"), options: .discreteAverage, start: start, end: end, completion: collect("vo2max"))
        group.enter()
        sleep(start: start, end: end) { r in lock.lock(); nights = r; lock.unlock(); group.leave() }

        group.notify(queue: .global()) {
            var days: [String: JSObject] = [:]
            for (field, values) in fields {
                for (day, v) in values { days[day, default: ["date": day]][field] = v }
            }
            for (day, n) in nights {
                var d = days[day, default: ["date": day]]
                d["sleepMinutes"] = n.asleep
                d["sleepDeepMinutes"] = n.deep
                d["sleepRemMinutes"] = n.rem
                if let s = n.start { d["sleepStart"] = self.iso.string(from: s) }
                if let e = n.end { d["sleepEnd"] = self.iso.string(from: e) }
                days[day] = d
            }
            call.resolve(["days": Array(days.values)])
        }
    }

    @objc func healthHeartRate(_ call: CAPPluginCall) {
        guard let start = date(call, "start"), let end = date(call, "end"), let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return call.reject("start/end required") }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let q = HKSampleQuery(sampleType: type, predicate: HKQuery.predicateForSamples(withStart: start, end: end), limit: 5000, sortDescriptors: [sort]) { [weak self] _, samples, _ in
            guard let self = self else { return }
            let bpm = HKUnit.count().unitDivided(by: .minute())
            // Thin to ≤ 1 sample per 2 minutes — plenty for a day chart.
            var out: [JSObject] = []
            var last = Date.distantPast
            for case let s as HKQuantitySample in samples ?? [] where s.startDate.timeIntervalSince(last) >= 120 {
                out.append(["t": self.iso.string(from: s.startDate), "v": s.quantity.doubleValue(for: bpm)])
                last = s.startDate
            }
            call.resolve(["samples": out])
        }
        health.execute(q)
    }

    @objc func healthWorkouts(_ call: CAPPluginCall) {
        guard let start = date(call, "start"), let end = date(call, "end") else { return call.reject("start/end required") }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let q = HKSampleQuery(sampleType: .workoutType(), predicate: HKQuery.predicateForSamples(withStart: start, end: end), limit: 50, sortDescriptors: [sort]) { [weak self] _, samples, _ in
            guard let self = self else { return }
            let out: [JSObject] = (samples as? [HKWorkout] ?? []).map { w in
                var o: JSObject = [
                    "id": w.uuid.uuidString,
                    "type": Self.workoutName(w.workoutActivityType),
                    "start": self.iso.string(from: w.startDate),
                    "end": self.iso.string(from: w.endDate),
                    "source": w.sourceRevision.source.name,
                ]
                if let kcalType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
                   let kcal = w.statistics(for: kcalType)?.sumQuantity()?.doubleValue(for: .kilocalorie()) {
                    o["kcal"] = kcal
                }
                if let m = w.totalDistance?.doubleValue(for: .meter()) { o["distanceM"] = m }
                return o
            }
            call.resolve(["workouts": out])
        }
        health.execute(q)
    }

    private static func workoutName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: return "Running"
        case .cycling: return "Cycling"
        case .walking: return "Walking"
        case .hiking: return "Hiking"
        case .swimming: return "Swimming"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "Strength"
        case .highIntensityIntervalTraining: return "HIIT"
        case .yoga: return "Yoga"
        case .rowing: return "Rowing"
        case .soccer: return "Football"
        case .tennis: return "Tennis"
        default: return "Workout"
        }
    }

    // MARK: - EventKit

    @objc func calendarAuthorize(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            events.requestFullAccessToEvents { ok, _ in call.resolve(["granted": ok]) }
        } else {
            events.requestAccess(to: .event) { ok, _ in call.resolve(["granted": ok]) }
        }
    }

    @objc func calendarEvents(_ call: CAPPluginCall) {
        guard let start = date(call, "start"), let end = date(call, "end") else { return call.reject("start/end required") }
        let pred = events.predicateForEvents(withStart: start, end: end, calendars: nil)
        let out: [JSObject] = events.events(matching: pred).map { e in
            var o: JSObject = [
                "id": "\(e.calendarItemIdentifier)@\(Int(e.startDate.timeIntervalSince1970))",
                "title": e.title ?? "(no title)",
                "start": iso.string(from: e.startDate),
                "end": iso.string(from: e.endDate),
                "allDay": e.isAllDay,
                "calendar": e.calendar.title,
            ]
            if let l = e.location, !l.isEmpty { o["location"] = l }
            if let n = e.notes, !n.isEmpty { o["notes"] = String(n.prefix(2000)) }
            if let c = e.calendar.cgColor?.components, c.count >= 3 {
                o["color"] = String(format: "#%02X%02X%02X", Int(c[0] * 255), Int(c[1] * 255), Int(c[2] * 255))
            }
            return o
        }
        call.resolve(["events": out])
    }

    // MARK: - Mini-apps

    /// Stable UUID per app id → its own persistent WKWebsiteDataStore (iOS 17+).
    static func storeId(_ id: String) -> UUID {
        let h = Array(SHA256.hash(data: Data(id.utf8)))
        return UUID(uuid: (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8], h[9], h[10], h[11], h[12], h[13], h[14], h[15]))
    }

    @objc func openMiniApp(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let urlStr = call.getString("url"), let url = URL(string: urlStr), url.scheme == "https" else {
            return call.reject("id and https url required")
        }
        let title = call.getString("title") ?? ""
        let ua = call.getString("userAgent")
        DispatchQueue.main.async {
            let vc = self.miniApps[id] ?? MiniAppController(id: id, url: url, title: title, userAgent: ua) { [weak self] t in
                self?.notifyListeners("miniAppTitle", data: ["id": id, "title": t])
            }
            self.miniApps[id] = vc
            let nav = UINavigationController(rootViewController: vc)
            nav.modalPresentationStyle = .fullScreen
            self.bridge?.viewController?.present(nav, animated: true) { call.resolve() }
        }
    }

    @objc func clearMiniApp(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("id required") }
        DispatchQueue.main.async {
            self.miniApps[id] = nil
            WKWebsiteDataStore.remove(forIdentifier: Self.storeId(id)) { _ in call.resolve() }
        }
    }
}

/// Full-screen host for one embedded web app. Kept alive between openings so
/// conversations/inboxes don't reload every time.
final class MiniAppController: UIViewController, WKUIDelegate, WKNavigationDelegate {
    private let appId: String
    private let url: URL
    private let userAgent: String?
    private let onTitle: (String) -> Void
    private var webView: WKWebView!
    private var titleObs: NSKeyValueObservation?

    init(id: String, url: URL, title: String, userAgent: String?, onTitle: @escaping (String) -> Void) {
        self.appId = id
        self.url = url
        self.userAgent = userAgent
        self.onTitle = onTitle
        super.init(nibName: nil, bundle: nil)
        self.title = title
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.045, alpha: 1)
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = WKWebsiteDataStore(forIdentifier: LifeNativePlugin.storeId(appId))
        cfg.allowsInlineMediaPlayback = true
        cfg.defaultWebpagePreferences.preferredContentMode = userAgent == nil ? .recommended : .desktop
        webView = WKWebView(frame: view.bounds, configuration: cfg)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.customUserAgent = userAgent
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        view.addSubview(webView)
        titleObs = webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
            if let t = wv.title { self?.onTitle(t) }
        }
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reload))
        webView.load(URLRequest(url: url))
    }

    @objc private func close() { dismiss(animated: true) }
    @objc private func reload() { webView.reload() }

    // Links that open a new window (target=_blank) load in place.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }
}

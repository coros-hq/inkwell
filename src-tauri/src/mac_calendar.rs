//! Bridge to the macOS Calendar database (EventKit) so the in-app calendar can
//! sync with Apple Calendar and every account added to it (iCloud, Google, ...).
//! Days and times cross the boundary as the same local `YYYY-MM-DD` / `HH:MM`
//! strings the app stores, so nothing shifts across time zones. Recurring events
//! come back as read-only occurrences; everything else can be edited both ways.
//! EventKit is macOS-only; elsewhere every command reports `unsupported`.

use serde::{Deserialize, Serialize};

/// Name of the calendar Inkwell's own events are written to.
const INKWELL_CALENDAR: &str = "Inkwell";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacCalendar {
    pub id: String,
    pub title: String,
    pub color: String,
    pub source: String,
    pub writable: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MacEvent {
    /// EventKit identifier; empty when creating. Recurring occurrences are `<id>#<occurrence secs>`.
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub calendar_id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub date: String,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    /// Hex colour of the owning calendar (read only).
    #[serde(default)]
    pub color: String,
    /// True when the event can't be written back faithfully (recurring, spans midnight, read-only calendar).
    #[serde(default)]
    pub read_only: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_app_kit::{NSColor, NSColorSpace};
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventStore, EKSourceType, EKSpan,
    };
    use objc2_foundation::{
        NSArray, NSCalendar, NSCalendarUnit, NSDate, NSDateComponents, NSError, NSString,
    };
    use objc2_foundation::NSRunLoop;
    use std::cell::RefCell;
    use std::sync::{mpsc, Mutex, OnceLock};
    use std::time::Duration;

    pub fn status() -> &'static str {
        let s = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
        if s == EKAuthorizationStatus::NotDetermined {
            "notDetermined"
        } else if s == EKAuthorizationStatus::FullAccess {
            "authorized"
        } else if s == EKAuthorizationStatus::Denied {
            "denied"
        } else {
            // Restricted by policy, or write-only (not enough to read the user's events).
            "restricted"
        }
    }

    pub fn request_access() -> Result<bool, String> {
        // The worker asks for access when it starts (showing the prompt the first time).
        on_worker(|| Ok(status() == "authorized"))
    }

    // EventKit wants one long-lived store whose thread keeps a run loop turning, or it can
    // report "authorized" yet hand back an empty database. So every call runs on a single
    // worker thread that owns the store, asks for access once, and pumps its run loop.
    type Job = Box<dyn FnOnce() + Send>;
    static WORKER: OnceLock<Mutex<mpsc::Sender<Job>>> = OnceLock::new();
    thread_local! { static STORE: RefCell<Option<Retained<EKEventStore>>> = const { RefCell::new(None) }; }

    fn run_worker(rx: mpsc::Receiver<Job>) {
        let store = unsafe { EKEventStore::new() };
        let (tx, done) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe { store.requestFullAccessToEventsWithCompletion(&*block as *const _ as *mut _) };
        // Already allowed: the completion comes back at once. Otherwise the user is looking at the prompt.
        let wait = if status() == "authorized" { 5 } else { 300 };
        let _ = done.recv_timeout(Duration::from_secs(wait));
        STORE.with(|s| *s.borrow_mut() = Some(store));
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(job) => job(),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.01));
        }
    }

    /// Run `f` on the worker thread (starting it on first use) and wait for its result.
    pub fn on_worker<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
        let sender = WORKER.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<Job>();
            std::thread::Builder::new().name("mac-calendar".into()).spawn(move || run_worker(rx)).expect("failed to start the calendar thread");
            Mutex::new(tx)
        });
        let (tx, rx) = mpsc::channel();
        let job: Job = Box::new(move || {
            let _ = tx.send(f());
        });
        sender.lock().map_err(|_| "calendar thread is unavailable".to_string())?.send(job).map_err(|_| "calendar thread stopped".to_string())?;
        rx.recv().map_err(|_| "calendar thread stopped".to_string())?
    }

    fn open_store() -> Result<Retained<EKEventStore>, String> {
        if status() != "authorized" {
            return Err("Calendar access hasn't been granted. Allow inkwell in System Settings › Privacy & Security › Calendars.".into());
        }
        let store = STORE.with(|s| s.borrow().clone()).ok_or("calendar store isn't ready")?;
        // The store is long-lived and caches what it has read, so changes made in the Calendar
        // app wouldn't show up. No EventKit objects are kept between calls, so dropping the cache is safe.
        unsafe { store.reset() };
        NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.05));
        // Calendars load asynchronously; a store read straight after launch can be empty.
        for _ in 0..15 {
            unsafe {
                store.refreshSourcesIfNecessary();
                if !store.calendarsForEntityType(EKEntityType::Event).is_empty() {
                    break;
                }
            }
            NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.2));
        }
        Ok(store)
    }

    fn census(store: &EKEventStore) -> String {
        unsafe {
            let cals = store.calendarsForEntityType(EKEntityType::Event);
            format!(
                "status={}, accounts={}, calendars={}, writable={}",
                status(),
                store.sources().len(),
                cals.len(),
                cals.iter().filter(|c| c.allowsContentModifications()).count()
            )
        }
    }

    fn ns(s: &str) -> Retained<NSString> {
        NSString::from_str(s)
    }

    fn hex(cal: &EKCalendar) -> String {
        unsafe {
            let c = cal.color();
            match c.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) {
                Some(rgb) => {
                    let b = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                    format!("#{:02x}{:02x}{:02x}", b(rgb.redComponent()), b(rgb.greenComponent()), b(rgb.blueComponent()))
                }
                None => "#6366f1".into(),
            }
        }
    }

    fn to_calendar(cal: &EKCalendar) -> MacCalendar {
        unsafe {
            MacCalendar {
                id: cal.calendarIdentifier().to_string(),
                title: cal.title().to_string(),
                color: hex(cal),
                source: cal.source().map(|s| s.title().to_string()).unwrap_or_default(),
                writable: cal.allowsContentModifications(),
            }
        }
    }

    pub fn calendars() -> Result<Vec<MacCalendar>, String> {
        let store = open_store()?;
        let all = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
        Ok(all.iter().map(|c| to_calendar(&c)).collect())
    }

    // ── dates ────────────────────────────────────────────────────────────────

    const UNITS: NSCalendarUnit = NSCalendarUnit(
        NSCalendarUnit::Year.0
            | NSCalendarUnit::Month.0
            | NSCalendarUnit::Day.0
            | NSCalendarUnit::Hour.0
            | NSCalendarUnit::Minute.0,
    );

    /// (YYYY-MM-DD, minutes into that local day)
    fn split(date: &NSDate) -> (String, i64) {
        let c = NSCalendar::currentCalendar().components_fromDate(UNITS, date);
        (
            format!("{:04}-{:02}-{:02}", c.year(), c.month(), c.day()),
            (c.hour() * 60 + c.minute()) as i64,
        )
    }

    fn parse_day(key: &str) -> Result<(isize, isize, isize), String> {
        let mut it = key.split('-').map(|p| p.parse::<isize>());
        match (it.next(), it.next(), it.next()) {
            (Some(Ok(y)), Some(Ok(m)), Some(Ok(d))) => Ok((y, m, d)),
            _ => Err(format!("bad date: {key}")),
        }
    }

    fn parse_time(t: &str) -> Result<(isize, isize), String> {
        let mut it = t.split(':').map(|p| p.parse::<isize>());
        match (it.next(), it.next()) {
            (Some(Ok(h)), Some(Ok(m))) => Ok((h, m)),
            _ => Err(format!("bad time: {t}")),
        }
    }

    fn make_date(day: &str, time: Option<&str>) -> Result<Retained<NSDate>, String> {
        let (y, m, d) = parse_day(day)?;
        let (h, min) = match time {
            Some(t) => parse_time(t)?,
            None => (0, 0),
        };
        let c = NSDateComponents::new();
        c.setYear(y);
        c.setMonth(m);
        c.setDay(d);
        c.setHour(h);
        c.setMinute(min);
        NSCalendar::currentCalendar()
            .dateFromComponents(&c)
            .ok_or_else(|| format!("invalid date: {day}"))
    }

    fn hhmm(min: i64) -> String {
        format!("{:02}:{:02}", min / 60, min % 60)
    }

    // ── events ───────────────────────────────────────────────────────────────

    fn to_event(ev: &EKEvent) -> Option<MacEvent> {
        unsafe {
            let cal = ev.calendar()?;
            let start = ev.startDate();
            let end = ev.endDate();
            let recurring = ev.hasRecurrenceRules();
            let mut id = ev.eventIdentifier()?.to_string();
            if recurring {
                id = format!("{id}#{}", start.timeIntervalSince1970() as i64);
            }
            let (date, start_min) = split(&start);
            let (end_day, end_min) = split(&end);
            let mut read_only = recurring || !cal.allowsContentModifications();
            let (mut end_date, mut start_time, mut end_time) = (None, None, None);

            if ev.isAllDay() {
                // All-day ends at 23:59:59 (or the next midnight, depending on the source).
                let last = if end.timeIntervalSince1970() > start.timeIntervalSince1970() { split(&NSDate::dateWithTimeIntervalSince1970(end.timeIntervalSince1970() - 1.0)).0 } else { date.clone() };
                if last > date { end_date = Some(last) }
            } else if end_day == date {
                start_time = Some(hhmm(start_min));
                end_time = Some(hhmm(end_min.max(start_min)));
            } else if end_min == 0 && next_day(&date).as_deref() == Some(end_day.as_str()) {
                // Runs to midnight: clamp to the last slot of the day.
                start_time = Some(hhmm(start_min));
                end_time = Some("23:45".into());
                read_only = true;
            } else {
                // Spans midnight: shown as an all-day bar, which can't hold its times.
                let last = split(&NSDate::dateWithTimeIntervalSince1970(end.timeIntervalSince1970() - 1.0)).0;
                if last > date { end_date = Some(last) }
                read_only = true;
            }

            Some(MacEvent {
                id,
                calendar_id: cal.calendarIdentifier().to_string(),
                title: ev.title().to_string(),
                notes: ev.notes().map(|n| n.to_string()).unwrap_or_default(),
                date,
                end_date,
                start_time,
                end_time,
                color: hex(&cal),
                read_only,
            })
        }
    }

    fn next_day(day: &str) -> Option<String> {
        let d = make_date(day, None).ok()?;
        let next = NSDate::dateWithTimeIntervalSince1970(d.timeIntervalSince1970() + 36.0 * 3600.0);
        Some(split(&next).0)
    }

    pub fn fetch(start: &str, end: &str, calendar_ids: &[String]) -> Result<Vec<MacEvent>, String> {
        let store = open_store()?;
        let from = make_date(start, None)?;
        let to = make_date(end, Some("23:59"))?;
        let cals: Vec<Retained<EKCalendar>> = calendar_ids
            .iter()
            .filter_map(|id| unsafe { store.calendarWithIdentifier(&ns(id)) })
            .collect();
        if cals.is_empty() {
            return Ok(vec![]);
        }
        let list = NSArray::from_retained_slice(&cals);
        unsafe {
            let pred = store.predicateForEventsWithStartDate_endDate_calendars(&from, &to, Some(&list));
            let events = store.eventsMatchingPredicate(&pred);
            Ok(events.iter().filter_map(|e| to_event(&e)).collect())
        }
    }

    /// The dedicated "Inkwell" calendar, created on first use in the default
    /// calendar's account (falling back to any account that allows new calendars).
    pub fn ensure_inkwell_calendar() -> Result<MacCalendar, String> {
        let store = open_store()?;
        unsafe {
            let all = store.calendarsForEntityType(EKEntityType::Event);
            if let Some(c) = all.iter().find(|c| c.title().to_string() == INKWELL_CALENDAR && c.allowsContentModifications()) {
                return Ok(to_calendar(&c));
            }
            // Accounts appear lazily after access is first granted.
            store.refreshSourcesIfNecessary();
            let writable = |c: &Retained<EKCalendar>| c.allowsContentModifications();
            let default = store.defaultCalendarForNewEvents();
            // An account that can own calendars: the default calendar's, then any writable
            // calendar's, then any account that isn't subscribed/birthdays.
            let source = default
                .as_ref()
                .and_then(|c| c.source())
                .or_else(|| store.calendarsForEntityType(EKEntityType::Event).iter().find(writable).and_then(|c| c.source()))
                .or_else(|| {
                    store
                        .sources()
                        .iter()
                        .find(|s| s.sourceType() != EKSourceType::Subscribed && s.sourceType() != EKSourceType::Birthdays)
                });
            let created = source.and_then(|source| {
                let cal = EKCalendar::calendarForEntityType_eventStore(EKEntityType::Event, &store);
                cal.setTitle(&ns(INKWELL_CALENDAR));
                cal.setColor(Some(&NSColor::colorWithSRGBRed_green_blue_alpha(0.388, 0.4, 0.945, 1.0)));
                cal.setSource(Some(&source));
                store.saveCalendar_commit_error(&cal, true).ok().map(|_| cal)
            });
            // Couldn't make one (e.g. the account doesn't allow new calendars): use an existing writable one.
            let cal = created
                .or(default.filter(writable))
                .or_else(|| store.calendarsForEntityType(EKEntityType::Event).iter().find(writable))
                .ok_or_else(|| format!("no writable calendar found ({}) — add an account in System Settings › Internet Accounts, or create a calendar in the Calendar app", census(&store)))?;
            Ok(to_calendar(&cal))
        }
    }

    pub fn upsert(event: MacEvent) -> Result<MacEvent, String> {
        if event.id.contains('#') {
            return Err("recurring events can't be edited from inkwell".into());
        }
        let store = open_store()?;
        unsafe {
            let ev = if event.id.is_empty() {
                let ev = EKEvent::eventWithEventStore(&store);
                let cal = if event.calendar_id.is_empty() {
                    None
                } else {
                    store.calendarWithIdentifier(&ns(&event.calendar_id))
                };
                let cal = match cal {
                    Some(c) => c,
                    None => {
                        let id = ensure_inkwell_calendar()?.id;
                        store.calendarWithIdentifier(&ns(&id)).ok_or("Inkwell calendar disappeared")?
                    }
                };
                ev.setCalendar(Some(&cal));
                ev
            } else {
                store.eventWithIdentifier(&ns(&event.id)).ok_or("event no longer exists in Calendar")?
            };

            ev.setTitle(Some(&ns(&event.title)));
            let notes = ns(&event.notes);
            ev.setNotes(if event.notes.is_empty() { None } else { Some(&*notes) });
            match &event.start_time {
                Some(start) => {
                    let end = event.end_time.clone().unwrap_or_else(|| {
                        let (h, m) = parse_time(start).unwrap_or((0, 0));
                        hhmm(((h * 60 + m + 60) as i64).min(23 * 60 + 59))
                    });
                    ev.setAllDay(false);
                    ev.setStartDate(Some(&*make_date(&event.date, Some(start))?));
                    ev.setEndDate(Some(&*make_date(&event.date, Some(&end))?));
                }
                None => {
                    // All-day events end on their (inclusive) last day.
                    let last = event.end_date.as_deref().unwrap_or(&event.date);
                    ev.setAllDay(true);
                    ev.setStartDate(Some(&*make_date(&event.date, None)?));
                    ev.setEndDate(Some(&*make_date(last, None)?));
                }
            }
            store
                .saveEvent_span_error(&ev, EKSpan::ThisEvent)
                .map_err(|e| e.localizedDescription().to_string())?;
            to_event(&ev).ok_or_else(|| "saved event could not be read back".to_string())
        }
    }

    pub fn delete(id: &str) -> Result<(), String> {
        if id.contains('#') {
            return Err("recurring events can't be deleted from inkwell".into());
        }
        let store = open_store()?;
        unsafe {
            // Already gone is as good as deleted.
            if let Some(ev) = store.eventWithIdentifier(&ns(id)) {
                store
                    .removeEvent_span_error(&ev, EKSpan::ThisEvent)
                    .map_err(|e| e.localizedDescription().to_string())?;
            }
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    const NO: &str = "macOS Calendar sync is only available on macOS";
    pub fn on_worker<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> { f() }
    pub fn status() -> &'static str { "unsupported" }
    pub fn request_access() -> Result<bool, String> { Err(NO.into()) }
    pub fn calendars() -> Result<Vec<MacCalendar>, String> { Err(NO.into()) }
    pub fn fetch(_: &str, _: &str, _: &[String]) -> Result<Vec<MacEvent>, String> { Err(NO.into()) }
    pub fn ensure_inkwell_calendar() -> Result<MacCalendar, String> { Err(NO.into()) }
    pub fn upsert(_: MacEvent) -> Result<MacEvent, String> { Err(NO.into()) }
    pub fn delete(_: &str) -> Result<(), String> { Err(NO.into()) }
}

// EventKit objects aren't Send, so each command builds its own store inside a
// blocking task and only plain data crosses back.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || imp::on_worker(f)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn mac_calendar_status() -> &'static str {
    imp::status()
}

#[tauri::command]
pub async fn mac_calendar_request_access() -> Result<bool, String> {
    blocking(imp::request_access).await
}

#[tauri::command]
pub async fn mac_calendar_list() -> Result<Vec<MacCalendar>, String> {
    blocking(imp::calendars).await
}

#[tauri::command]
pub async fn mac_calendar_ensure_inkwell() -> Result<MacCalendar, String> {
    blocking(imp::ensure_inkwell_calendar).await
}

#[tauri::command]
pub async fn mac_calendar_fetch(start: String, end: String, calendar_ids: Vec<String>) -> Result<Vec<MacEvent>, String> {
    blocking(move || imp::fetch(&start, &end, &calendar_ids)).await
}

#[tauri::command]
pub async fn mac_calendar_upsert(event: MacEvent) -> Result<MacEvent, String> {
    blocking(move || imp::upsert(event)).await
}

#[tauri::command]
pub async fn mac_calendar_delete(id: String) -> Result<(), String> {
    blocking(move || imp::delete(&id)).await
}

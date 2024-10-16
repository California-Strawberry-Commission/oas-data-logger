#include "dlf_logger.h"

#include "components/dlf_sync.h"
#include "components/dlf_wifi.h"

CSCLogger::CSCLogger(FS &fs, String fs_dir) : _fs(fs), fs_dir(fs_dir) {
    ev = xEventGroupCreate();
    this->setup(&components);
    add_component(this);
}

run_handle_t CSCLogger::get_available_handle() {
    for (size_t i = 0; i < MAX_RUNS; i++) {
        if (!runs[i])
            return i + 1;
    }

    return 0;
}

bool CSCLogger::run_is_active(const char *uuid) {
    for (size_t i = 0; i < MAX_RUNS; i++)
        if (runs[i] && !strcmp(runs[i]->uuid(), uuid)) return true;
    return false;
}

run_handle_t CSCLogger::start_run(Encodable meta, std::chrono::microseconds tick_rate) {
    run_handle_t h = get_available_handle();

    // If 0, out of space.
    if (!h)
        return h;

    Serial.printf("Starting logging with a cycle time-base of %dms\n", tick_rate);

    // Initialize new run
    dlf::Run *run = new dlf::Run(_fs, data_streams, tick_rate, meta);

    if (run == NULL)
        return 0;

    runs[h - 1] = std::unique_ptr<dlf::Run>(run);

    return h;
}

void CSCLogger::stop_run(run_handle_t h) {
    if (!runs[h - 1])
        return;

    runs[h - 1]->close();
    runs[h - 1].reset();
    xEventGroupSetBits(ev, NEW_RUN);
}

CSCLogger &CSCLogger::_watch(Encodable value, String id, const char *notes) {
    using namespace dlf::datastream;

    AbstractStream *s = new EventStream(value, id, notes);
    data_streams.push_back(s);

    return *this;
}

CSCLogger &CSCLogger::_poll(Encodable value, String id, microseconds sample_interval, microseconds phase, const char *notes) {
    using namespace dlf::datastream;

    AbstractStream *s = new PolledStream(value, id, sample_interval, phase, notes);
    data_streams.push_back(s);

    return *this;
}

CSCLogger &CSCLogger::syncTo(String server_ip, uint16_t port) {
    if (!has_component<CSCDBSynchronizer>())
        add_component(new CSCDBSynchronizer(_fs, fs_dir));

    get_component<CSCDBSynchronizer>()->syncTo(server_ip, port);

    return *this;
}

CSCLogger &CSCLogger::wifi(String ssid, String password) {
    if (!has_component<CSCDBSynchronizer>())
        add_component(new CSCWifiClient(ssid, password));

    return *this;
}

bool CSCLogger::begin() {
    Serial.println("CSC Logger init");
    prune();

    // Set subcomponent stores to enable component communication
    for (BaseComponent *&comp : components) {
        comp->setup(&components);
    }

    // begin subcomponents
    for (BaseComponent *&comp : components) {
        // Break recursion
        if (comp == this)
            continue;

        comp->begin();
    }

    return true;
}

void CSCLogger::prune() {
    File root = _fs.open(fs_dir);

    File run_dir;
    while (run_dir = root.openNextFile()) {
        // Skip sys vol information file
        if (!strcmp(run_dir.name(), "System Volume Information"))
            continue;

        if (!run_dir.isDirectory())
            continue;

        // Search for lockfiles. Delete run if found (was dirty when closed).
        File run_file;
        while (run_file = run_dir.openNextFile()) {
            if (!strcmp(run_file.name(), LOCKFILE_NAME)) {
                Serial.printf("Pruning %s\n", (fs_dir + run_dir.name()).c_str());

                run_dir.rewindDirectory();
                while (run_file = run_dir.openNextFile()) {
                    _fs.remove(fs_dir + run_dir.name() + "/" + run_file.name());
                }

                _fs.rmdir(fs_dir + run_dir.name());
                break;
            }
        }
    }
    root.close();
}

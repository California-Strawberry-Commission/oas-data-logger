#include "dlflib/dlf_logger.h"

#include "dlflib/components/uploader_component.h"

CSCLogger::CSCLogger(fs::FS& fs, String fs_dir) : _fs(fs), fs_dir(fs_dir) {
  ev = xEventGroupCreate();
  this->setup(&components);
  addComponent(this);
}

run_handle_t CSCLogger::get_available_handle() {
  for (size_t i = 0; i < MAX_RUNS; i++) {
    if (!runs[i]) return i + 1;
  }

  return 0;
}

bool CSCLogger::run_is_active(const char* uuid) {
  for (size_t i = 0; i < MAX_RUNS; i++) {
    if (runs[i] && !strcmp(runs[i]->uuid(), uuid)) {
      return true;
    }
  }
  return false;
}

run_handle_t CSCLogger::start_run(Encodable meta,
                                  std::chrono::microseconds tick_rate) {
  run_handle_t h = get_available_handle();

  // If 0, out of space.
  if (!h) {
    return h;
  }

  Serial.printf("Starting logging with a cycle time-base of %dus\n", tick_rate);

  // Initialize new run
  dlf::Run* run = new dlf::Run(_fs, fs_dir, data_streams, tick_rate, meta);

  if (run == NULL) {
    return 0;
  }

  runs[h - 1] = std::unique_ptr<dlf::Run>(run);

  return h;
}

void CSCLogger::stop_run(run_handle_t h) {
  if (!runs[h - 1]) {
    return;
  }

  runs[h - 1]->close();
  runs[h - 1].reset();
  xEventGroupSetBits(ev, NEW_RUN);
}

CSCLogger& CSCLogger::_watch(Encodable value, String id, const char* notes,
                             SemaphoreHandle_t mutex) {
  using namespace dlf::datastream;

  AbstractStream* s = new EventStream(value, id, notes, mutex);
  data_streams.push_back(s);

  return *this;
}

CSCLogger& CSCLogger::_poll(Encodable value, String id,
                            microseconds sample_interval, microseconds phase,
                            const char* notes, SemaphoreHandle_t mutex) {
  using namespace dlf::datastream;

  AbstractStream* s =
      new PolledStream(value, id, sample_interval, phase, notes, mutex);
  data_streams.push_back(s);

  return *this;
}

CSCLogger& CSCLogger::syncTo(
    const String& endpoint, const String& deviceUid,
    const dlf::components::UploaderComponent::Options& options) {
  if (!hasComponent<dlf::components::UploaderComponent>()) {
    addComponent(new dlf::components::UploaderComponent(_fs, fs_dir, endpoint,
                                                        deviceUid, options));
  }

  return *this;
}

void CSCLogger::waitForSyncCompletion() {
  if (hasComponent<dlf::components::UploaderComponent>()) {
    getComponent<dlf::components::UploaderComponent>()->waitForSyncCompletion();
  }
}

bool CSCLogger::begin() {
  Serial.println("CSC Logger init");
  prune();

  // Set subcomponent stores to enable component communication
  for (dlf::components::DlfComponent*& comp : components) {
    comp->setup(&components);
  }

  // begin subcomponents
  for (dlf::components::DlfComponent*& comp : components) {
    // Break recursion
    if (comp == this) {
      continue;
    }

    comp->begin();
  }

  return true;
}

void CSCLogger::prune() {
  File root = _fs.open(fs_dir);

  File run_dir;
  while (run_dir = root.openNextFile()) {
    // Skip files and sys vol information dir
    if (!run_dir.isDirectory() ||
        !strcmp(run_dir.name(), "System Volume Information")) {
      continue;
    }

    // Search for lockfiles. Delete run if found (was dirty when closed).
    String run_dir_path = resolvePath({fs_dir, run_dir.name()});
    File run_file;
    while (run_file = run_dir.openNextFile()) {
      if (!strcmp(run_file.name(), LOCKFILE_NAME)) {
        Serial.printf("Pruning %s\n", run_dir_path.c_str());

        run_dir.rewindDirectory();
        while (run_file = run_dir.openNextFile()) {
          _fs.remove(resolvePath({run_dir_path, run_file.name()}));
        }

        _fs.rmdir(run_dir_path);
        break;
      }
    }
  }
  root.close();
}

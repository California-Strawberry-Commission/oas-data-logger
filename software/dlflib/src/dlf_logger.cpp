#include "dlflib/dlf_logger.h"

#include "dlflib/components/uploader_component.h"
#include "dlflib/dlf_cfg.h"

namespace dlf {

CSCLogger::CSCLogger(fs::FS& fs, String fsDir) : fs_(fs), fsDir_(fsDir) {
  loggerEventGroup_ = xEventGroupCreate();
  this->setup(&components_);
  addComponent(this);
}

run_handle_t CSCLogger::getAvailableHandle() {
  for (size_t i = 0; i < MAX_RUNS; i++) {
    if (!runs_[i]) return i + 1;
  }

  return 0;
}

bool CSCLogger::runIsActive(const char* uuid) {
  for (size_t i = 0; i < MAX_RUNS; i++) {
    if (runs_[i] && !strcmp(runs_[i]->uuid(), uuid)) {
      return true;
    }
  }
  return false;
}

run_handle_t CSCLogger::startRun(Encodable meta,
                                 std::chrono::microseconds tickRate) {
  run_handle_t h = getAvailableHandle();

  // If 0, out of space.
  if (!h) {
    return h;
  }

  Serial.printf("Starting logging with a cycle time-base of %dus\n", tickRate);

  // Initialize new run
  dlf::Run* run = new dlf::Run(fs_, fsDir_, streams_, tickRate, meta);

  if (run == NULL) {
    return 0;
  }

  runs_[h - 1] = std::unique_ptr<dlf::Run>(run);

  return h;
}

void CSCLogger::stopRun(run_handle_t h) {
  if (!runs_[h - 1]) {
    return;
  }

  runs_[h - 1]->close();
  runs_[h - 1].reset();
  xEventGroupSetBits(loggerEventGroup_, NEW_RUN);
}

CSCLogger& CSCLogger::watchInternal(Encodable value, String id,
                                    const char* notes,
                                    SemaphoreHandle_t mutex) {
  dlf::datastream::AbstractStream* s =
      new dlf::datastream::EventStream(value, id, notes, mutex);
  streams_.push_back(s);

  return *this;
}

CSCLogger& CSCLogger::pollInternal(Encodable value, String id,
                                   std::chrono::microseconds sampleInterval,
                                   std::chrono::microseconds phase,
                                   const char* notes, SemaphoreHandle_t mutex) {
  dlf::datastream::AbstractStream* s = new dlf::datastream::PolledStream(
      value, id, sampleInterval, phase, notes, mutex);
  streams_.push_back(s);

  return *this;
}

CSCLogger& CSCLogger::syncTo(
    const String& endpoint, const String& deviceUid,
    const dlf::components::UploaderComponent::Options& options) {
  if (!hasComponent<dlf::components::UploaderComponent>()) {
    addComponent(new dlf::components::UploaderComponent(fs_, fsDir_, endpoint,
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
  for (dlf::components::DlfComponent*& comp : components_) {
    comp->setup(&components_);
  }

  // begin subcomponents
  for (dlf::components::DlfComponent*& comp : components_) {
    // Break recursion
    if (comp == this) {
      continue;
    }

    comp->begin();
  }

  return true;
}

void CSCLogger::prune() {
  fs::File root = fs_.open(fsDir_);

  fs::File run_dir;
  while (run_dir = root.openNextFile()) {
    // Skip files and sys vol information dir
    if (!run_dir.isDirectory() ||
        !strcmp(run_dir.name(), "System Volume Information")) {
      continue;
    }

    // Search for lockfiles. Delete run if found (was dirty when closed).
    String run_dir_path = dlf::util::resolvePath({fsDir_, run_dir.name()});
    fs::File run_file;
    while (run_file = run_dir.openNextFile()) {
      if (!strcmp(run_file.name(), LOCKFILE_NAME)) {
        Serial.printf("Pruning %s\n", run_dir_path.c_str());

        run_dir.rewindDirectory();
        while (run_file = run_dir.openNextFile()) {
          fs_.remove(dlf::util::resolvePath({run_dir_path, run_file.name()}));
        }

        fs_.rmdir(run_dir_path);
        break;
      }
    }
  }
  root.close();
}

}  // namespace dlf
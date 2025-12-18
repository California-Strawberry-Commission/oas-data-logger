#include "dlflib/dlf_logger.h"

#include "dlflib/components/uploader_component.h"
#include "dlflib/dlf_cfg.h"

namespace dlf {

CSCLogger::CSCLogger(fs::FS& fs, String fsDir) : fs_(fs), fsDir_(fsDir) {
  loggerEventGroup_ = xEventGroupCreate();
  this->setup(&components_);
  addComponent(this);
}

bool CSCLogger::begin() {
  Serial.println("[CSCLogger] Begin");
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

run_handle_t CSCLogger::startRun(Encodable meta,
                                 std::chrono::microseconds tickRate) {
  run_handle_t h = getAvailableHandle();

  // If 0, out of space.
  if (!h) {
    return h;
  }

  Serial.printf("[CSCLogger] Starting logging with a cycle time-base of %dus\n",
                tickRate);

  // Initialize new run
  dlf::Run* run = new dlf::Run(fs_, fsDir_, streams_, tickRate, meta);

  if (run == NULL) {
    return 0;
  }

  int runIdx = h - 1;
  runs_[runIdx] = std::unique_ptr<dlf::Run>(run);

  return h;
}

void CSCLogger::stopRun(run_handle_t h) {
  int runIdx = h - 1;
  if (runIdx < 0 || runIdx >= MAX_RUNS || !runs_[runIdx]) {
    return;
  }

  runs_[runIdx]->close();
  runs_[runIdx].reset();
  xEventGroupSetBits(loggerEventGroup_, NEW_RUN);
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

std::vector<run_handle_t> CSCLogger::getActiveRuns() {
  std::vector<run_handle_t> activeRuns;
  for (size_t i = 0; i < MAX_RUNS; ++i) {
    if (runs_[i]) {
      run_handle_t handle = i + 1;
      activeRuns.push_back(handle);
    }
  }
  return activeRuns;
}

Run* CSCLogger::getRun(run_handle_t h) {
  int runIdx = h - 1;
  if (runIdx < 0 || runIdx >= MAX_RUNS || !runs_[runIdx]) {
    return nullptr;
  }

  return runs_[runIdx].get();
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

run_handle_t CSCLogger::getAvailableHandle() {
  for (size_t i = 0; i < MAX_RUNS; i++) {
    if (!runs_[i]) {
      return i + 1;
    }
  }

  return 0;
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
        Serial.printf("[CSCLogger] Pruning %s\n", run_dir_path.c_str());

        String lockfile_path{
            dlf::util::resolvePath({run_dir_path, LOCKFILE_NAME})};
        if (fs_.remove(lockfile_path)) {
          Serial.printf("[CSCLogger] Successfully removed lockfile: %s\n",
                        lockfile_path.c_str());
        } else {
          Serial.printf("[CSCLogger] ERROR: Failed to remove lockfile: %s\n",
                        lockfile_path.c_str());
        }
        break;
      }
    }
  }
  root.close();
}

}  // namespace dlf
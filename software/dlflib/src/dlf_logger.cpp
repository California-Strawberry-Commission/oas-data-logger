#include "dlflib/dlf_logger.h"

#include "dlflib/components/uploader_component.h"
#include "dlflib/dlf_cfg.h"
#include "dlflib/log.h"

namespace dlf {

DLFLogger::DLFLogger(fs::FS& fs, String fsDir) : fs_(fs), fsDir_(fsDir) {
  loggerEventGroup_ = xEventGroupCreate();
  this->setup(&components_);
  addComponent(this);
}

bool DLFLogger::begin() {
  DLFLIB_LOG_INFO("[DLFLogger] Begin");
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

run_handle_t DLFLogger::startRun(Encodable meta,
                                 std::chrono::microseconds tickRate) {
  run_handle_t h = getAvailableHandle();

  // If 0, out of space.
  if (!h) {
    return h;
  }

  DLFLIB_LOG_INFO("[DLFLogger] Starting logging with a cycle time-base of %dus",
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

void DLFLogger::stopRun(run_handle_t h) {
  int runIdx = h - 1;
  if (runIdx < 0 || runIdx >= MAX_RUNS || !runs_[runIdx]) {
    return;
  }

  runs_[runIdx]->close();
  runs_[runIdx].reset();
  xEventGroupSetBits(loggerEventGroup_, NEW_RUN);
}

DLFLogger& DLFLogger::syncTo(
    const String& endpoint, const String& deviceUid, const String& secret,
    const dlf::components::UploaderComponent::Options& options) {
  if (!hasComponent<dlf::components::UploaderComponent>()) {
    auto* uploader{new dlf::components::UploaderComponent(
        fs_, fsDir_, endpoint, deviceUid, secret, options)};

    addComponent(uploader);
  }

  return *this;
}

void DLFLogger::waitForSyncCompletion() {
  if (hasComponent<dlf::components::UploaderComponent>()) {
    getComponent<dlf::components::UploaderComponent>()->waitForSyncCompletion();
  }
}

std::vector<run_handle_t> DLFLogger::getActiveRuns() {
  std::vector<run_handle_t> activeRuns;
  for (size_t i = 0; i < MAX_RUNS; ++i) {
    if (runs_[i]) {
      run_handle_t handle = i + 1;
      activeRuns.push_back(handle);
    }
  }
  return activeRuns;
}

Run* DLFLogger::getRun(run_handle_t h) {
  int runIdx = h - 1;
  if (runIdx < 0 || runIdx >= MAX_RUNS || !runs_[runIdx]) {
    return nullptr;
  }

  return runs_[runIdx].get();
}

DLFLogger& DLFLogger::watchInternal(Encodable value, String id,
                                    const char* notes,
                                    SemaphoreHandle_t mutex) {
  dlf::datastream::AbstractStream* s =
      new dlf::datastream::EventStream(value, id, notes, mutex);
  streams_.push_back(s);

  return *this;
}

DLFLogger& DLFLogger::pollInternal(Encodable value, String id,
                                   std::chrono::microseconds sampleInterval,
                                   std::chrono::microseconds phase,
                                   const char* notes, SemaphoreHandle_t mutex) {
  dlf::datastream::AbstractStream* s = new dlf::datastream::PolledStream(
      value, id, sampleInterval, phase, notes, mutex);
  streams_.push_back(s);

  return *this;
}

run_handle_t DLFLogger::getAvailableHandle() {
  for (size_t i = 0; i < MAX_RUNS; i++) {
    if (!runs_[i]) {
      return i + 1;
    }
  }

  return 0;
}

void DLFLogger::prune() {
  fs::File root = fs_.open(fsDir_);

  fs::File runDir;
  while (runDir = root.openNextFile()) {
    // Skip files and sys vol information dir
    if (!runDir.isDirectory() ||
        !strcmp(runDir.name(), "System Volume Information")) {
      continue;
    }

    // The presence of a lockfile indicates that the run was not closed properly
    // (for example, due to power loss during a run). In this case, we still
    // want to upload the data for the run. In order to do that, we'll remove
    // the lockfile so that the uploader will attempt to upload this run
    String runDirPath = dlf::util::resolvePath({fsDir_, runDir.name()});
    fs::File runFile;
    while (runFile = runDir.openNextFile()) {
      if (!strcmp(runFile.name(), LOCKFILE_NAME)) {
        DLFLIB_LOG_INFO("[DLFLogger] Pruning %s", runDirPath.c_str());

        String lockfilePath{
            dlf::util::resolvePath({runDirPath, LOCKFILE_NAME})};
        if (fs_.remove(lockfilePath)) {
          DLFLIB_LOG_INFO("[DLFLogger] Successfully removed lockfile: %s",
                          lockfilePath.c_str());
        } else {
          DLFLIB_LOG_ERROR("[DLFLogger] ERROR: Failed to remove lockfile: %s",
                           lockfilePath.c_str());
        }
        break;
      }
    }
  }
  root.close();
}

}  // namespace dlf
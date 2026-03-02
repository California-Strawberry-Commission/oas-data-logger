#include "dlflib/dlf_logger.h"

#include "dlflib/components/uploader_component.h"
#include "dlflib/dlf_cfg.h"
#include "dlflib/log.h"

namespace dlf {

DLFLogger::DLFLogger(fs::FS& fs, const String& fsDir) : fs_(fs), fsDir_(fsDir) {
  loggerEventGroup_ = xEventGroupCreate();
  // Wire the registry into `this` so getComponent works from DLFLogger
  this->setRegistry(this);
}

DLFLogger::~DLFLogger() {
  // Stop all active runs
  for (auto& run : runs_) {
    if (run) {
      run->close();
      run.reset();
    }
  }

  // Delete FreeRTOS event group
  if (loggerEventGroup_) {
    vEventGroupDelete(loggerEventGroup_);
    loggerEventGroup_ = nullptr;
  }
}

bool DLFLogger::begin() {
  DLFLIB_LOG_INFO("[DLFLogger] Begin");
  prune();

  // Begin subcomponents
  for (const auto& componentPtr : components_) {
    auto* component = componentPtr.get();
    if (!component) {
      continue;
    }

    componentPtr->begin();
  }

  return true;
}

run_handle_t DLFLogger::startRun(const Encodable& meta,
                                 std::chrono::microseconds tickRate) {
  run_handle_t h = getAvailableHandle();

  // A handle of 0 indicates that no more runs can be started (max active runs
  // has been reached)
  if (h == 0) {
    return 0;
  }

  DLFLIB_LOG_INFO("[DLFLogger] Starting logging with a tick rate of %lldus",
                  (long long)tickRate.count());

  // Initialize new run
  int idx = h - 1;
  runs_[idx] =
      dlf::util::make_unique<dlf::Run>(fs_, fsDir_, streams_, tickRate, meta);

  return h;
}

void DLFLogger::stopRun(run_handle_t h) {
  int idx = h - 1;
  if (idx < 0 || idx >= MAX_ACTIVE_RUNS || !runs_[idx]) {
    return;
  }

  runs_[idx]->close();
  runs_[idx].reset();
  xEventGroupSetBits(loggerEventGroup_, RUN_COMPLETE);
}

DLFLogger& DLFLogger::syncTo(
    const String& endpoint, const String& deviceUid,
    const dlf::components::UploaderComponent::Options& options) {
  return syncTo(endpoint, deviceUid, "", options);
}

DLFLogger& DLFLogger::syncTo(
    const String& endpoint, const String& deviceUid, const String& secret,
    const dlf::components::UploaderComponent::Options& options) {
  if (!hasComponent<dlf::components::UploaderComponent>()) {
    auto uploader = dlf::util::make_unique<dlf::components::UploaderComponent>(
        fs_, fsDir_.c_str(), endpoint.c_str(), deviceUid.c_str(),
        secret.c_str(), options);
    addComponent(std::move(uploader));
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
  activeRuns.reserve(MAX_ACTIVE_RUNS);
  for (int i = 0; i < MAX_ACTIVE_RUNS; ++i) {
    if (runs_[i]) {
      run_handle_t handle = i + 1;
      activeRuns.push_back(handle);
    }
  }
  return activeRuns;
}

Run* DLFLogger::getRun(run_handle_t h) {
  int idx = h - 1;
  if (idx < 0 || idx >= MAX_ACTIVE_RUNS || !runs_[idx]) {
    return nullptr;
  }

  return runs_[idx].get();
}

DLFLogger& DLFLogger::watchInternal(const Encodable& value, const String& id,
                                    const char* notes,
                                    SemaphoreHandle_t mutex) {
  streams_.push_back(dlf::util::make_unique<dlf::datastream::EventStream>(
      value, id, notes, mutex));
  return *this;
}

DLFLogger& DLFLogger::pollInternal(const Encodable& value, const String& id,
                                   std::chrono::microseconds sampleInterval,
                                   std::chrono::microseconds phase,
                                   const char* notes, SemaphoreHandle_t mutex) {
  streams_.push_back(dlf::util::make_unique<dlf::datastream::PolledStream>(
      value, id, sampleInterval, phase, notes, mutex));
  return *this;
}

run_handle_t DLFLogger::getAvailableHandle() {
  for (int i = 0; i < MAX_ACTIVE_RUNS; ++i) {
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

dlf::components::Component* DLFLogger::findById(size_t id) const {
  // Allow finding DLFLogger itself
  if (id == dlf::util::hashType<DLFLogger>()) {
    return const_cast<DLFLogger*>(this);
  }

  for (const auto& componentPtr : components_) {
    if (componentPtr && componentPtr->id() == id) {
      return componentPtr.get();
    }
  }
  return nullptr;
}

}  // namespace dlf
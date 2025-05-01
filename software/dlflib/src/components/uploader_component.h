#pragma once

#include <Arduino.h>
#include <FS.h>

#include "dlf_component.h"

class UploaderComponent : public DlfComponent {
 public:
  static void taskSync(void *arg);

  UploaderComponent(FS &fs, String fsDir, String host, uint16_t port);
  bool begin();
  bool uploadRun(File run_dir, String path);

 private:
  FS &fs_;
  String dir_;
  String host_;
  uint16_t port_;
  size_t maxRetries_;
};
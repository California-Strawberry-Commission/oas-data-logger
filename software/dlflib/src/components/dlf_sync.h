#pragma once

#include <Arduino.h>
#include <FS.h>

#include "dlf_base_component.h"

class CSCDBSynchronizer : public BaseComponent {
 public:
  CSCDBSynchronizer(FS &fs, String fs_dir = "/", size_t max_retries = 10);
  void syncTo(String server_ip, uint16_t port);
  bool begin();
  bool upload_run(File run_dir, String path);
  static void task_sync(void *arg);

 private:
  String server_ip;
  FS &_fs;
  String dir;
  uint16_t port;
  size_t max_retries;

  EventGroupHandle_t state;
};
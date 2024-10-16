#pragma once

#include <Arduino.h>
#include <FS.h>

#include "dlf_base_component.h"

class CSCDBSynchronizer : public BaseComponent {
    String server_ip;
    FS &_fs;
    String dir;
    uint16_t port;
    size_t max_retries;

    EventGroupHandle_t state;

   public:
    CSCDBSynchronizer(FS &fs, String fs_dir = "/", size_t max_retries = 10);

    void syncTo(String server_ip, uint16_t port);

    bool begin();

    // https://arduino.stackexchange.com/questions/93818/arduinohttpclient-post-multipart-form-data-from-sd-card-returning-400-bad-reques
    bool upload_run(File run_dir, String path);

    static void task_sync(void *arg);

};
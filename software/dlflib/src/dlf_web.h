#include <Arduino.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>
#include <rom/miniz.h>

// tar decompression lib
#include <SD_MMC.h>
#include <cpio.h>

// https://github.com/zhouhan0126/DNSServer---esp32/blob/master/examples/CaptivePortalAdvanced/CaptivePortalAdvanced.ino
// https://github.com/espressif/arduino-esp32/blob/master/libraries/WebServer/examples/SDWebServer/SDWebServer.ino
class DLFWeb {
    uint16_t port;
    DNSServer dnsServer;
    WebServer server;

    uint16_t port;

    DLFWeb(uint16_t port = 80) : port(port) {
    }

    void begin() {
        server.begin(port);
    }

    void handle_hello() {
        server.send(200, "text/plain", "HI THERE :)");
    }

    int load_from_sd(String path) {
        Serial.println("Load SD");
        // xSemaphoreTake(rm.sd_mutex, portMAX_DELAY);

        if (!SD_MMC.begin()) return 1;

        String dataType = "text/plain";
        if (path.endsWith("/")) {
            path += "index.htm";
        }

        if (path.endsWith(".src")) {
            path = path.substring(0, path.lastIndexOf("."));
        } else if (path.endsWith(".htm")) {
            dataType = "text/html";
        } else if (path.endsWith(".css")) {
            dataType = "text/css";
        } else if (path.endsWith(".js")) {
            dataType = "application/javascript";
        } else if (path.endsWith(".png")) {
            dataType = "image/png";
        } else if (path.endsWith(".gif")) {
            dataType = "image/gif";
        } else if (path.endsWith(".jpg")) {
            dataType = "image/jpeg";
        } else if (path.endsWith(".ico")) {
            dataType = "image/x-icon";
        } else if (path.endsWith(".xml")) {
            dataType = "text/xml";
        } else if (path.endsWith(".pdf")) {
            dataType = "application/pdf";
        } else if (path.endsWith(".zip")) {
            dataType = "application/zip";
        }

        File dataFile = SD_MMC.open(path.c_str());
        if (dataFile.isDirectory()) {
            path += "/index.htm";
            dataType = "text/html";
            dataFile = SD_MMC.open(path.c_str());
        }

        if (!dataFile) {
            return 2;
        }

        if (server.hasArg("download")) {
            dataType = "application/octet-stream";
        }

        if (server.streamFile(dataFile, dataType) != dataFile.size()) {
            Serial.println("Sent less data than expected!");
        }

        dataFile.close();
        // xSemaphoreGive(rm.sd_mutex);

        return 0;
    }

    void handle_not_found() {
        int res = load_from_sd(server.uri());
        if (res == 0) {
            return;
        } else if (res == 1) {
            String message = "SDCARD Not Detected\n\n";
            message += "URI: ";
            message += server.uri();
            message += "\nMethod: ";
            message += (server.method() == HTTP_GET) ? "GET" : "POST";
            message += "\nArguments: ";
            message += server.args();
            message += "\n";
            for (uint8_t i = 0; i < server.args(); i++) {
                message += " NAME:" + server.argName(i) + "\n VALUE:" + server.arg(i) + "\n";
            }
            server.send(404, "text/plain", message);
            Serial.print(message);
        } else {
            server.send(404, "text/html", R"(
<html>
    <head>
    <title>Not found</title>
    </head>
    <body>
    Maybe you need to
    <a href="/update_web">Upload the server files?</a>
    </body>
</html>
    )");
        }
    }

    void handle_web_update_page() {
        Serial.println("Update");
        server.send(200, "text/html", R"(
<html>
    <head>
    <title>DAQ Page Upload</title>
    </head>
    <body>
    NOTE: NOT WORKING YET. do not touch
    <form action="/update_web" method="post" enctype="multipart/form-data">
        <input type="file" id="myFile" name="web_update">
        <input type="submit">
    </form>
    </body>
</html>
    )");
    }

    void handle_web_update_upload() {
        Serial.println("Upload");
        if (server.uri() != "/update_web")
            return;

        Serial.println("HANDING WEB FW UPLOAD!");
        // https://esp32.com/viewtopic.php?t=28548
        HTTPUpload& upload = server.upload();
        if (upload.status == UPLOAD_FILE_START) {
            // uploadFile = SD.open(upload.filename.c_str(), FILE_WRITE);
            Serial.print("Upload: START, filename: ");
            Serial.println(upload.filename);
        } else if (upload.status == UPLOAD_FILE_WRITE) {
            // if (uploadFile) {
            //     uploadFile.write(upload.buf, upload.currentSize);
            // }
            Serial.print("Upload: WRITE, Bytes: ");
            Serial.println(upload.currentSize);
        } else if (upload.status == UPLOAD_FILE_END) {
            // if (uploadFile) {
            //     uploadFile.close();
            // }
            Serial.print("Upload: END, Size: ");
            Serial.println(upload.totalSize);
        }
    }

    void task_web(void* arg) {
        DLFWeb* a = static_cast<DLFWeb*>(arg);

        dnsServer.start(53, "*", WiFi.softAPIP());

        server.on("/hello", HTTP_GET, handle_hello);
        server.on("/update_web", HTTP_GET, handle_web_update_page);
        server.on(
            "/update_web", HTTP_POST,
            []() {
                server.send(200, "text/plain", "");
            },
            handle_web_update_upload);

        server.onNotFound(handle_not_found);

        server.begin();

        while (1) {
            dnsServer.processNextRequest();
            server.handleClient();
            vTaskDelay(pdMS_TO_TICKS(5));
        }
    }

    bool init() {
        // Serial.println("Starting WIFI");

        WiFi.mode(WIFI_AP);
        WiFi.softAP("bdaq2");

        xTaskCreate(task_web, "web", 4096, NULL, 9, NULL);

        return true;
    }
}

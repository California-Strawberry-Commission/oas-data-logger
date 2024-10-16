# ESPDAQ 2023
Latest revision of ESP32-based DAQ for CP Baja SAE.

Currently very, very much in development.

# Goals
I imagine this as a general-purpose Data Acquisition (DAQ) library that can be easily integrated into any existing ESP32 code base. 
### Planned features
- Web interface
  - DAQ management
  - Data viewing
  - Tuning
- Efficiency
  - Custom file format to allow high-rate, long-duration logs
- Ease of integration
  - Directly hooks into existing variables using the fun of pointers.
# Todo
- [x] [File Format Planning](firmware/lib/dlflib/DLF_FILES.md) (done, but needs additional documentation)
- [ ] Firmware 
  - [x] Data stream framework
  - [ ] Run logging framework (IN PROGRESS)
  - [ ] Tuning endpoints
  - [ ] Web integration framework
    - Want to allow both usage as standalone lib but also allow integration into existing ESPAsyncWebserver applications on a subpath. Necessitates breaking out web drivers into abstract class (I think)
  - [ ] [Database](firmware/lib/dlflib/INDEX_FILE.md)
- [ ] Web UI
  - [ ] DLF file lib
  - [ ] Charts
  - [ ] Customization
    - [ ] Chart layout
    - [ ] Selection of what fields to log
- [ ] Cross-Web-Firmware typing
  - Essentially need protobufs but... Not a fan of protobufs. Why use an existing lib when you can make your own ;)

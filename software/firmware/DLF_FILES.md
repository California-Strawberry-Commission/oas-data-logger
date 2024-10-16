# Run Files
These are the random alphanumeric files (IE `7AF3887778205E8C3E032BD2062136E7`) in the SD card's root directory. They store run data as well as user-definable run metadata. 

## Motivation
To understand the file format, consider my guiding principals for this format:
- Metadata should be stored with run data in the same file
- Data should be "seekable". That is, knowing only information provided in the file metadata, a byte offset can be calculated to get a value at a given time.
- Data should be kept as small as possible.
  - This is ***extremely*** important, because if datafiles can be kept small enough, the strategy for displaying data becomes much, much easier. Small files (~300MB) can be loaded and manipulated in a browser without the need for chunking or streaming, which **greatly, greatly** reduces load and code complexity on the ESP. **This advantage cannot be understated.** 
- The storage layer can be considered reliable (subject to change)
  - Just means that we don't bother with checksums or similar.
- One-time overheads (I.E. header size) are not as important to optimize as ongoing overheads (Data)

# Data Streams
In the context of this project, a *data stream* is simply a region of memory that is polled at some interval during logging. More practically, it is probably a struct containing some relevant grouped data. Data streams can be polled at rates that make sense for them, optimizing storage efficiency and performance. For example, accelerometer data can be polled every 10ms while GPS data can be polled ever 1000ms as new solutions are generated. The idea is to only log as fast as a data source can reliably produce data. 

# Time Base
Every run has a common "*tick time*", which is the minimum interval at which data is polled, defined in *microseconds* Data streams can be polled at any multiple of interval, including at every tick. Sources cannot be polled faster than the tick interval. Additionally, neither the tick interval nor any data stream tick interval can change mid-run. 

The tick and interval concept is how the 2023 DAQ is able to store data in a binary stream with 0 overhead and enable seeking (in polled data sections). Given the ratio of cycles between two values, it's possible to figure out how many of each will occur, and where in the data stream each value is. Consider the following data values we want to store (`D1`, and `D2`)

```
D1: Cycle interval of 1 (every cycle), CI(1)
D2: Cycle interval of 2 (every other cycle), CI(2)

Raw Data Stream: D1 D2 D1 D1 D2 D1 D1 D2 D1

Data Stream Cycles
0: D1 D2
1: D1 
2: D1 D2
3: D1 
4: D1 D2
5: D1 
```

Notice that after the initial cycle (where every data source is polled), `D1` occurs twice as often as `D2`. Knowing the ratio of `D1` to `D2`, therefore, allows a pattern to develop that we can exploit to find data without the need for mid-stream markers. The *tick interval* then allows us to map from cycle count to time, completing the DAQ.

# Format
***NOTE: Full format structs can be found in [dlf_types.h](../dlflib/src/dlf_types.h)***

A full dataset ("run") consists of multiple files - one metadata file and one file per datastream type. Datasets can be compressed into archives (Likely tar - TBD) for offloading/distribution. Typically, the run will consist of arbitrary **metadata**, a **polled data** file and an **event data** file. These two files are similar in that they both store generic binary data, but differ in how they do it. The polled file format is optimized for continuously updating data (IE accelerometer, GPS, etc...) while the event data format is optimized for data that updates infrequently (Marker button, remotely tuned parameters, etc...). Each section contains a prepended header. More information is available about this header in each section's respective section.

## Polled Data 
...TODO

## Event Data
...TODO

# Code Structure
The general ownership structure goes: 

```Logger -> Run -> Logfile[] -> Stream Handles[]```

where each level gets more granular in referencing underlying data. 
## `Logger`
The `Logger` class, which all user interaction is performed with, manages one or more `Run` class instances. These are created/closed by functions called by the library user. IE a `Run` is created when a user calls `start_run()` on the `Logger` instance. Users interact with active runs through !!TODO.

## `Run`
A `Run` instance encapsulates all the necessary machinery to log data during a time interval. This includes selecting a UUID, creating the directory structure where actual data files will reside, creating/managing `LogFile`s, and metering sampling. It is also responsible for cleanup once the user decides to finish a run. 

## `LogFile`
A `LogFile` instance is responsible for writing `Stream` data to disk. One `LogFile` instance maps to one file within a managed `Run` directory. A `LogFile` instance manages only one type of data (`POLLED` or `EVENT`) due to the different encoding of each type (this separation is handled at construction). `LogFile` instances are NOT responsible for metering data. 

## `Stream Handles`
Provide an interface to underlying data. They provide metering.
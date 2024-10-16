# __INDEX
`__INDEX` is a file stored on the SD card which is used to index all runs. 
It exists to enable fast access to metadata.

## Motivation
Consider a user trying to access a specific run on the DAQ. 
They want to (obviously) see what runs are available to browse before selecting one. 
This means we need some way to send them a list of run names, descriptions, locations, 
etc so they can make an informed decision about what they want to view.
Lets call this listing of all files an **index**.

The naive way to serve this index would be to - on every request - loop through all stored runs, extract their metadata, and send it to
the requester. The problem with this approach is that it's extremely taxing on the SD card, which is very very slow to do random reads. 
This means that this method gets ***slow*** very quickly. This is pretty much the approach used in the 2022 revision of the DAQ and it would take
multiple seconds to calc that data doing nothing else.

Another approach is to calculate the index once, on startup, and cache it in memory for fast access and (importantly) mutation. The problem
here is scale - Last year we easily got hundreds of runs. Imagine 300 runs contains a 64-byte name, and a 512-byte description.
Storing that amount of metadata would take up 172KB of the ESP's ram! Obviously, this could be optimized to be reasonable (you don't
need all 512 description bytes if you're description is 5 bytes long) but we can do better.

## Format
The chosen format for the index file is "partial JSON". That is, JSON without the start and end brackets.
Records for files will be listed as keys, with file metadata `printf`'d in JSON afterwards. Example:
```json
"file_name_1.bin": {"name":"A random run", "description": "a fun description"},
"file_name_2.bin": {"name":"Another random run", "description": "another fun description!"}
```
The main benefit of this approach is that file metadata mutation (IE changing a run name or description) is provided for free because the root JSON object is a hashmap. The Javascript `JSON.parse` keeps only the last key when multiple of the same are found. File entries can also be easily deleted in this way, simply by making the last key equal `null`.
```json
"file_name_1.bin": {"name":"A random run", "description": "a fun description"},
"file_name_2.bin": {"name":"Another random run", "description": "another fun description!"}
"file_name_1.bin": {"name":"A different name?", "description": "Wow this is different!"}
"file_name_2.bin": null
```
This index, when parsed by javascript, will resolve to `file1_name_1.bin`'s name being `"Another random run"` and  `file_name_2.bin` being null - or deleted. This allows the index to be mutated without modifying or even loading the entire file! The latest entry simply needs to be appended. This should keep things fast, yet simple.

This index can also be "collapsed" (where duplicate entries are removed) periodically to keep the filesize down. This should be relatively simple to do assuming filenames are kept to a constant length. 

## Ideas
- Collapsing could be easily done by letting the browser do all the hard parsing and deduplication work. **IDEA:** A POST endpoint that sets the current index.
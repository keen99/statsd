var dgram  = require('dgram')
  , util    = require('util')
  , net    = require('net')
  , config = require('./lib/config')
  , fs     = require('fs')
  , events = require('events')
  , logger = require('./lib/logger')
  , set = require('./lib/set')
  , pm = require('./lib/process_metrics')


// initialize data structures with defaults for statsd stats
var keyCounter = {};
var counters = {};
var timers = {};
var gauges = {};
var sets = {};
var counter_rates = {};
var timer_data = {};
var pctThreshold = null;
var debugInt, flushInterval, keyFlushInt, server, mgmtServer;
var startup_time = Math.round(new Date().getTime() / 1000);
var backendEvents = new events.EventEmitter();

// Load and init the backend from the backends/ directory.
function loadBackend(config, name) {
  var backendmod = require(name);

  if (config.debug) {
    l.log("Loading backend: " + name, 'DEBUG');
  }

  var ret = backendmod.init(startup_time, config, backendEvents);
  if (!ret) {
    l.log("Failed to load backend: " + name);
    process.exit(1);
  }
};

// global for conf
var conf;

// Flush metrics to each backend.
function flushMetrics() {
  var time_stamp = Math.round(new Date().getTime() / 1000);

  var metrics_hash = {
    counters: counters,
    gauges: gauges,
    timers: timers,
    sets: sets,
    counter_rates: counter_rates,
    timer_data: timer_data,
    pctThreshold: pctThreshold
  }

  // After all listeners, reset the stats
  backendEvents.once('flush', function clear_metrics(ts, metrics) {
	// TODO: a lot of this should be moved up into an init/constructor so we don't have to do it every
	// single flushInterval.... 
    // allows us to flag all of these on with a single config but still override them individually
    conf.deleteIdleStats = conf.deleteIdleStats !== undefined ? conf.deleteIdleStats : false;
    if (conf.deleteIdleStats) {
      conf.deleteCounters = conf.deleteCounters !== undefined ? conf.deleteCounters : true;
      conf.deleteTimers = conf.deleteTimers !== undefined ? conf.deleteTimers : true;
      conf.deleteSets = conf.deleteSets !== undefined ? conf.deleteSets : true;
      conf.deleteGauges = conf.deleteGauges !== undefined ? conf.deleteGauges : true;
    }

    // Clear the counters
    conf.deleteCounters = conf.deleteCounters || false;
<<<<<<< HEAD

    // handle the case where these vars are not setup - for this patch to work w/o requiring
    // the statsPrefix patch 
    var prefixStats;
    prefixStats       = conf.prefixStats;
    prefixStats     = prefixStats !== undefined ? prefixStats : "statsd";
    //setup the names for the stats stored in counters{}
    bad_lines_seen = prefixStats + ".bad_lines_seen";
    packets_received = prefixStats + ".packets_received";

    for (key in metrics.counters) {
=======
    for (var key in metrics.counters) {
    conf.deleteTimers = conf.deleteTimers || false;
    for (key in metrics.timers) {
      if (conf.deleteTimers) {
        delete(metrics.timers[key]);
      } else {
        metrics.timers[key] = [];
     }
    }

    // Clear the sets
    conf.deleteSets = conf.deleteSets || false;
    for (key in metrics.sets) {
      if (conf.deleteSets) {
        delete(metrics.sets[key]);
      } else {
        metrics.sets[key] = new set.Set();
	  }
    }

	// normally gauges are not reset.  so if we don't delete them, continue to persist previous value
    conf.deleteGauges = conf.deleteGauges || false;
    if (conf.deleteGauges) {
     for (key in metrics.gauges) {
        delete(metrics.gauges[key]);
     }
=======
    for (var key in metrics.timers) {
      metrics.timers[key] = [];
    }

    // Clear the sets
    for (var key in metrics.sets) {
      metrics.sets[key] = new set.Set();
>>>>>>> p/debugupdates
    }
  });

  pm.process_metrics(metrics_hash, flushInterval, time_stamp, function emitFlush(metrics) {
    backendEvents.emit('flush', time_stamp, metrics);
  });

};

var stats = {
  messages: {
    last_msg_seen: startup_time,
    bad_lines_seen: 0
  }
};

// Global for the logger
var l;

config.configFile(process.argv[2], function (config, oldConfig) {
  conf = config;
  if (! config.debug && debugInt) {
    clearInterval(debugInt);
    debugInt = false;
  }

  l = new logger.Logger(config.log || {});

  if (config.debug) {
    if (debugInt !== undefined) {
      clearInterval(debugInt);
    }
    debugInt = setInterval(function () {
      l.log("\nCounters:\n" + util.inspect(counters) +
               "\nTimers:\n" + util.inspect(timers) +
               "\nSets:\n" + util.inspect(sets) +
               "\nGauges:\n" + util.inspect(gauges), 'DEBUG');
    }, config.debugInterval || 10000);
  }

  // setup config for stats prefix
  prefixStats       = config.prefixStats;
  prefixStats     = prefixStats !== undefined ? prefixStats : "statsd";
  //setup the names for the stats stored in counters{}
  bad_lines_seen = prefixStats + ".bad_lines_seen";
  packets_received = prefixStats + ".packets_received";

  //now set to zero so we can increment them 
  counters[bad_lines_seen] = 0;
  counters[packets_received] = 0;

  if (server === undefined) {

    // key counting
    var keyFlushInterval = Number((config.keyFlush && config.keyFlush.interval) || 0);

    server = dgram.createSocket('udp4', function (msg, rinfo) {
      backendEvents.emit('packet', msg, rinfo);
      counters[packets_received]++;
      var metrics = msg.toString().split("\n");

      for (var midx in metrics) {
        if (config.dumpMessages) {
          l.log(metrics[midx].toString());
        }
        var bits = metrics[midx].toString().split(':');
        var key = bits.shift()
                      .replace(/\s+/g, '_')
                      .replace(/\//g, '-')
                      .replace(/[^a-zA-Z_\-0-9\.]/g, '');

        if (keyFlushInterval > 0) {
          if (! keyCounter[key]) {
            keyCounter[key] = 0;
          }
          keyCounter[key] += 1;
        }

        if (bits.length == 0) {
          bits.push("1");
        }

        for (var i = 0; i < bits.length; i++) {
          var sampleRate = 1;
          var fields = bits[i].split("|");
          if (fields[1] === undefined) {
              l.log('Bad line: ' + fields + ' in msg "' + metrics[midx] +'"');
              counters[bad_lines_seen]++;
              stats['messages']['bad_lines_seen']++;
              continue;
          }
          if (fields[1].trim() == "ms") {
            if (! timers[key]) {
              timers[key] = [];
            }
            timers[key].push(Number(fields[0] || 0));
          } else if (fields[1].trim() == "g") {
            gauges[key] = Number(fields[0] || 0);
          } else if (fields[1].trim() == "s") {
            if (! sets[key]) {
              sets[key] = new set.Set();
            }
            sets[key].insert(fields[0] || '0');
          } else {
            if (fields[2]) {
              if (fields[2].match(/^@([\d\.]+)/)) {
                sampleRate = Number(fields[2].match(/^@([\d\.]+)/)[1]);
              } else {
                l.log('Bad line: ' + fields + ' in msg "' + metrics[midx] +'"; has invalid sample rate');
                counters[bad_lines_seen]++;
                stats['messages']['bad_lines_seen']++;
                continue;
              }
            }
            if (! counters[key]) {
              counters[key] = 0;
            }
            counters[key] += Number(fields[0] || 1) * (1 / sampleRate);
          }
        }
      }

      stats['messages']['last_msg_seen'] = Math.round(new Date().getTime() / 1000);
    });

    mgmtServer = net.createServer(function(stream) {
      stream.setEncoding('ascii');

      stream.on('error', function(err) {
        l.log('Caught ' + err +', Moving on')
      });

      stream.on('data', function(data) {
        var cmdline = data.trim().split(" ");
        var cmd = cmdline.shift();

        switch(cmd) {
          case "help":
            stream.write("Commands: stats, counters, timers, gauges, delcounters, deltimers, delgauges, quit\n\n");
            break;

          case "stats":
            var now    = Math.round(new Date().getTime() / 1000);
            var uptime = now - startup_time;

            stream.write("uptime: " + uptime + "\n");

            var stat_writer = function(group, metric, val) {
              var delta;

              if (metric.match("^last_")) {
                delta = now - val;
              }
              else {
                delta = val;
              }

              stream.write(group + "." + metric + ": " + delta + "\n");
            };

            // Loop through the base stats
            for (var group in stats) {
              for (var metric in stats[group]) {
                stat_writer(group, metric, stats[group][metric]);
              }
            }

            backendEvents.once('status', function(writeCb) {
              stream.write("END\n\n");
            });

            // Let each backend contribute its status
            backendEvents.emit('status', function(err, name, stat, val) {
              if (err) {
                l.log("Failed to read stats for backend " +
                         name + ": " + err);
              } else {
                stat_writer(name, stat, val);
              }
            });

            break;

          case "counters":
            stream.write(util.inspect(counters) + "\n");
            stream.write("END\n\n");
            break;

          case "timers":
            stream.write(util.inspect(timers) + "\n");
            stream.write("END\n\n");
            break;

          case "gauges":
            stream.write(util.inspect(gauges) + "\n");
            stream.write("END\n\n");
            break;

          case "delcounters":
            for (var index in cmdline) {
              delete counters[cmdline[index]];
              stream.write("deleted: " + cmdline[index] + "\n");
            }
            stream.write("END\n\n");
            break;

          case "deltimers":
            for (var index in cmdline) {
              delete timers[cmdline[index]];
              stream.write("deleted: " + cmdline[index] + "\n");
            }
            stream.write("END\n\n");
            break;

          case "delgauges":
            for (var index in cmdline) {
              delete gauges[cmdline[index]];
              stream.write("deleted: " + cmdline[index] + "\n");
            }
            stream.write("END\n\n");
            break;

          case "quit":
            stream.end();
            break;

          default:
            stream.write("ERROR\n");
            break;
        }

      });
    });

    server.bind(config.port || 8125, config.address || undefined);
    mgmtServer.listen(config.mgmt_port || 8126, config.mgmt_address || undefined);

    util.log("server is up");

    pctThreshold = config.percentThreshold || 90;
    if (!Array.isArray(pctThreshold)) {
      pctThreshold = [ pctThreshold ]; // listify percentiles so single values work the same
    }

    flushInterval = Number(config.flushInterval || 10000);
    config.flushInterval = flushInterval;

    if (config.backends) {
      for (var i = 0; i < config.backends.length; i++) {
        loadBackend(config, config.backends[i]);
      }
    } else {
      // The default backend is graphite
      loadBackend(config, './backends/graphite');
    }

    // Setup the flush timer
    var flushInt = setInterval(flushMetrics, flushInterval);

    if (keyFlushInterval > 0) {
      var keyFlushPercent = Number((config.keyFlush && config.keyFlush.percent) || 100);
      var keyFlushLog = config.keyFlush && config.keyFlush.log;

      keyFlushInt = setInterval(function () {
        var key;
        var sortedKeys = [];

        for (var key in keyCounter) {
          sortedKeys.push([key, keyCounter[key]]);
        }

        sortedKeys.sort(function(a, b) { return b[1] - a[1]; });

        var logMessage = "";
        var timeString = (new Date()) + "";

        // only show the top "keyFlushPercent" keys
        for (var i = 0, e = sortedKeys.length * (keyFlushPercent / 100); i < e; i++) {
          logMessage += timeString + " count=" + sortedKeys[i][1] + " key=" + sortedKeys[i][0] + "\n";
        }

        if (keyFlushLog) {
          var logFile = fs.createWriteStream(keyFlushLog, {flags: 'a+'});
          logFile.write(logMessage);
          logFile.end();
        } else {
          process.stdout.write(logMessage);
        }

        // clear the counter
        keyCounter = {};
      }, keyFlushInterval);
    }


  ;

  }
})

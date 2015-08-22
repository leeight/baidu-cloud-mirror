/**
 * @file main.js
 * @author leeight
 */

var path = require('path');
var fs = require('fs');
var url = require('url');
var qs = require('querystring');
var http = require('http');

var u = require('underscore');
var debug = require('debug')('baidu-cloud-mirror');
var Q = require('q');
var request = require('request');

var argv = require('yargs')
    .usage('Usage: $0 -h')
    .boolean('h', {alias: 'help', describe: 'Show this help message.'})
    .options('bduss', {describe: 'The BDUSS Cookie', requiresArg: true})
    .options('baiduid', {describe: 'The BAIDUID Cookie', requiresArg: true})
    .options('cache-dir', {describe: 'The local cache directory'})
    .options('port', {describe: 'The port', requiresArg: true})

    .default('port', '9964');


function main() {
    var args = argv.argv;
    if (args.h === true || args.help === true) {
        argv.showHelp();
        return;
    }

    var bduss = args.bduss || process.env.BDUSS;
    var baiduid = args.baiduid || process.env.BAIDUID;
    if (!bduss || !baiduid) {
        argv.showHelp();
        return;
    }

    var headers = {
        'Cookie': ['BDUSS=' + bduss, 'BAIDUID=' + baiduid].join('; '),
        'Referer': 'http://pan.baidu.com/disk/home',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.134 Safari/537.36'
    };
    request.get({url: 'http://pan.baidu.com/disk/home', headers: headers}, function (err, res, body) {
        if (err || res.statusCode !== 200) {
            throw (err || res.statusCode);
        }
        else {
            var p0 = /yunData.MYBDSTOKEN\s*=\s*(['"])([^'"]+)\1/;

            var m0 = p0.exec(body);
            if (!m0) {
                throw new Error('Invalid html format');
            }

            var bdstoken = m0[2];

            createServer({
                bdstoken: bdstoken,
                headers: headers,
                cacheDir: fs.existsSync(args['cache-dir']) ? args['cache-dir'] : null,
            }, args.port);
        }
    });
}

function getFileMeta(filePath, pancfg) {
    var deferred = Q.defer();

    var apiUrl = 'http://pan.baidu.com/api/filemetas?' + qs.encode({
        target: JSON.stringify([filePath]),
        dlink: 1,
        media: 0,
        bdstoken: pancfg.bdstoken,
        channel: 'chunlei',
        clienttype: 0,
        web: 1,
        /*eslint-disable*/
        app_id: 250528
        /*eslint-enable*/
    });
    var options = {
        url: apiUrl,
        headers: pancfg.headers
    };
    debug('getFileMeta = %j', options);
    request.get(options, function (err, res, body) {
        if (err || res.statusCode !== 200) {
            deferred.reject(err || new Error(body));
        }
        else {
            var meta = JSON.parse(body);
            if (meta.errno !== 0
                || !meta.info
                || !Array.isArray(meta.info)
                || meta.info.length !== 1
                || meta.info[0].path !== filePath) {
                deferred.reject(new Error(body));
            }
            else {
                deferred.resolve(meta);
            }
        }
    });

    return deferred.promise;
}


function createServer(pancfg, port) {
    debug('port = %s, pancfg = %j', port, pancfg);

    http.createServer(function (req, res) {
        var filePath = req.url;
        if (/^https?:\/\//.test(filePath)) {
            filePath = url.parse(filePath).pathname;
        }

        debug('filePath = %j', filePath);
        debug('req.headers = %j', req.headers);

        if (pancfg.cacheDir) {
            var localCache = path.join(pancfg.cacheDir, filePath);
            if (fs.existsSync(localCache)) {
                debug('localCache = %j', localCache);
                fs.createReadStream(localCache).pipe(res);
                return;
            }
        }

        getFileMeta(filePath, pancfg)
            .then(function (fileMeta) {
                debug('fileMeta = %j', fileMeta);

                var dlink = fileMeta.info[0].dlink;
                var options = {
                    url: dlink,
                    headers: pancfg.headers
                };

                var proxy = request.get(options);
                proxy.on('request', function (req) {
                    u.each(pancfg.headers, function (value, key) {
                        req.setHeader(key, value);
                    });
                });
                proxy.on('response', function (req) {
                    debug('res.headers = %j', req.headers);
                });
                proxy.pipe(res);
            })
            .catch(function (error) {
                res.end(error.toString());
            });
    }).listen(port);
}








if (require.main === module) {
    main();
}




/* vim: set ts=4 sw=4 sts=4 tw=120: */

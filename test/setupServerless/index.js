'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const spawn = require('child-process-ext/spawn');
const { ensureDir, ensureSymlink, writeJson, realpath, removeSync } = require('fs-extra');
const fetch = require('node-fetch');
const tar = require('tar');
const { memoize } = require('lodash');
const log = require('log').get('test');

const tmpDir = os.tmpdir();

const resolveMode = (options) => {
  if (!options) return 'direct';
  return options.mode === 'compiled' ? 'compiled' : 'direct';
};

const ignoreIfDoesntExist = (error) => {
  if (error.code !== 'ENOENT') throw error;
  return null;
};

module.exports = memoize((options = {}) => {
  const serverlessTmpDir = path.join(
    tmpDir,
    `serverless-enterprise-plugin-test-serverless-${crypto.randomBytes(2).toString('hex')}`
  );

  if (process.env.LOCAL_SERVERLESS_LINK_PATH) {
    // Test against local serverless installation which is expected to have
    // this instance of `@serverless/enterprise-plugin` linked in its node_modules
    const serverlessPath = path.resolve(process.env.LOCAL_SERVERLESS_LINK_PATH);
    return Promise.all([
      realpath(path.join(__dirname, '../..')),
      realpath(path.join(serverlessPath, 'node_modules/@serverless/enterprise-plugin')).catch(
        ignoreIfDoesntExist
      ),
    ]).then(([pluginPath, serverlessPluginPath]) => {
      if (!pluginPath || pluginPath !== serverlessPluginPath) {
        throw new Error(
          `LOCAL_SERVERLESS_LINK_PATH which resolves to ${serverlessPath}, doesn't point a ` +
            'serverless installation which links this installation of a plugin'
        );
      }
      log.notice(`Rely on 'serverless' at ${serverlessPath}`);
      return {
        root: serverlessPath,
        binary: path.join(serverlessPath, 'bin/serverless.js'),
        version: require(path.join(serverlessPath, 'package.json')).version,
        plugin: pluginPath,
      };
    });
  }

  log.notice(`Setup 'serverless' at ${serverlessTmpDir}`);
  return ensureDir(serverlessTmpDir)
    .then(() => {
      if (!options.shouldKeepServerlessDir) {
        process.on('exit', () => {
          try {
            removeSync(serverlessTmpDir);
          } catch (error) {
            // Safe to ignore
          }
        });
      }

      log.debug('... fetch tarball');
      return fetch('https://github.com/serverless/serverless/archive/master.tar.gz');
    })
    .then((res) => {
      const tarDeferred = tar.x({ cwd: serverlessTmpDir, strip: 1 });
      res.body.pipe(tarDeferred);
      return new Promise((resolve, reject) => {
        res.body.on('error', reject);
        tarDeferred.on('error', reject);
        tarDeferred.on('finish', resolve);
      });
    })
    .then(() => {
      log.debug('... patch serverless/package.json');
      const pkgJsonPath = `${serverlessTmpDir}/package.json`;
      const pkgJson = require(pkgJsonPath);
      // Do not npm install @serverless/enterprise-plugin
      // (local installation will be linked in further steps)
      delete pkgJson.dependencies['@serverless/enterprise-plugin'];
      // Prevent any postinstall setup (stats requests, automcomplete setup, logs etc.)
      delete pkgJson.scripts.postinstall;
      return writeJson(pkgJsonPath, pkgJson);
    })
    .then(() => {
      return spawn('npm', ['install', '--production'], { cwd: serverlessTmpDir });
    })
    .then(() => {
      log.debug('... link @serverless/enterprise-plugin dependency');
      const mode = resolveMode(options);
      return ensureSymlink(
        path.join(__dirname, `../../${mode === 'direct' ? '' : 'dist'}`),
        path.join(serverlessTmpDir, 'node_modules/@serverless/enterprise-plugin')
      );
    })
    .then(() => {
      return realpath(path.join(serverlessTmpDir, 'node_modules/@serverless/enterprise-plugin'));
    })
    .then((pluginPath) => {
      return {
        root: serverlessTmpDir,
        binary: path.join(serverlessTmpDir, 'bin/serverless.js'),
        version: require(`${serverlessTmpDir}/package`).version,
        plugin: pluginPath,
      };
    });
}, resolveMode);

'use strict';

const { getApp, createApp, getAccessKeyForTenant } = require('@serverless/platform-sdk');

module.exports = async function (orgName, appName) {
  let app = {};
  try {
    app = await getApp({
      tenant: orgName,
      app: appName,
    });
  } catch (e) {
    try {
      const parsed = JSON.parse(e.message);
      if (parsed.errorMessage.startsWith('Application not found')) {
        const token = await getAccessKeyForTenant(orgName);
        app = await createApp({
          tenant: orgName,
          app: appName,
          token,
        });
      } else {
        throw e;
      }
    } catch (jsonParseError) {
      throw e;
    }
  }

  return {
    appUid: app.appUid,
    orgUid: app.tenantUid,
  };
};

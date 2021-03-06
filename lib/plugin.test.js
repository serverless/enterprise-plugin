'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const _ = require('lodash');

const platformClientStub = {
  ServerlessSDK: class ServerlessSDK {
    constructor() {
      this.metadata = {
        get: async () => ({ supportedRegions: ['region'] }),
      };
    }
  },
};

describe('plugin', () => {
  let logsCollection;
  let wrap;
  let wrapClean;
  let removeDestination;
  let saveDeployment;
  let createAndSetDeploymentUid;
  let generate;
  let configureDeployProfile;
  let injectLogsIamRole;
  let setApiGatewayAccessLogFormat;
  let ServerlessEnterprisePlugin;
  let sls;

  before(() => {
    logsCollection = sinon.spy();
    wrap = sinon.spy();
    wrapClean = sinon.spy();
    removeDestination = sinon.spy();
    saveDeployment = sinon.spy();
    createAndSetDeploymentUid = sinon.spy();
    generate = sinon.spy();
    configureDeployProfile = sinon.spy();
    injectLogsIamRole = sinon.spy();
    setApiGatewayAccessLogFormat = sinon.spy();

    ServerlessEnterprisePlugin = proxyquire('./plugin', {
      './logsCollection': logsCollection,
      './wrap': wrap,
      './wrapClean': wrapClean,
      './removeDestination': removeDestination,
      './deployment': { saveDeployment, createAndSetDeploymentUid },
      './generateEvent': { eventDict: {}, generate },
      './deployProfile': { configureDeployProfile },
      './injectLogsIamRole': injectLogsIamRole,
      './isAuthenticated': () => true,
      './setApiGatewayAccessLogFormat': setApiGatewayAccessLogFormat,
      '@serverless/config/utils': {
        getLoggedInUser: () => ({
          accessKeys: {
            tenant: '12345',
          },
          idToken: 'ID',
        }),
      },
      '@serverless/platform-client': platformClientStub,
      './appUids': () => ({ appUid: '000000000000000000', orgUid: '000000000000000000' }),
    });

    // REMOVING GETPROVIDREMOCK() AND LOGMOCK() AND USING THESLS INSTANCE BELOW

    // Mock Serverless Instance
    sls = {
      classes: { Error },
      getProvider: sinon.stub().returns({
        getStage: () => 'stage',
        getRegion: () => 'region',
      }),
      service: {
        service: 'service',
        app: 'app',
        org: 'org',
        provider: { variableSyntax: '\\${([ ~:a-zA-Z0-9._@\'",\\-\\/\\(\\)*]+?)}' },
      },
      cli: {
        log: sinon.spy(),
      },
      processedInput: {
        commands: [],
        options: {
          type: 'sqs',
        },
      },
      pluginManager: {
        plugins: [],
        commands: {},
      },
      _commandsSchema: new Map(),
    };

    sinon.stub(console, 'log');
  });
  // eslint-disable-next-line no-console
  after(() => console.log.restore());

  it('constructs and sets hooks', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.asyncInit();
    expect(Object.keys(instance.hooks).sort()).to.deep.equal(
      [
        'before:package:createDeploymentArtifacts',
        'after:package:createDeploymentArtifacts',
        'before:deploy:function:packageFunction',
        'after:deploy:function:packageFunction',
        'before:invoke:local:invoke',
        'before:aws:package:finalize:saveServiceState',
        'before:deploy:deploy',
        'before:aws:deploy:deploy:createStack',
        'after:aws:deploy:finalize:cleanup',
        'after:deploy:finalize',
        'after:deploy:deploy',
        'before:info:info',
        'after:info:info',
        'before:logs:logs',
        'before:metrics:metrics',
        'before:remove:remove',
        'after:remove:remove',
        'after:invoke:local:invoke',
        'before:offline:start:init',
        'before:step-functions-offline:start',
        'login:login',
        'logout:logout',
        'generate-event:generate-event',
        'test:test',
        'dashboard:dashboard',
        'output:get:get',
        'output:list:list',
        'param:get:get',
        'param:list:list',
        'studio:studio',
      ].sort()
    );
    expect(new Set(Object.keys(instance.variableResolvers))).to.deep.equal(
      new Set(['param', 'secrets', 'state', 'output'])
    );
    expect(sls.getProvider.calledWith('aws')).to.be.true;
    expect(sls.cli.log.callCount).to.equal(0);
  });

  it('construct requires org', async () => {
    const slsClone = _.cloneDeep(sls);
    delete slsClone.service.org;
    const instance = new ServerlessEnterprisePlugin(slsClone);
    await instance.asyncInit();
    expect(slsClone.getProvider.calledWith('aws')).to.be.true;
    expect(sls.cli.log.callCount).to.equal(0);
  });

  it('construct disallows variable use', () => {
    const slsClone = _.cloneDeep(sls);
    slsClone.service.org = '${self:custom.foobar}';
    expect(() => new ServerlessEnterprisePlugin(slsClone)).to.throw(
      '"app" and "org" in your serverless config can not use the variable system'
    );
    expect(sls.cli.log.callCount).to.equal(0);
  });

  it('routes before:package:createDeploymentArtifacts hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.asyncInit();
    await instance.route('before:package:createDeploymentArtifacts')();
    expect(wrap.calledWith(instance)).to.be.true;
    expect(injectLogsIamRole.calledWith(instance)).to.be.true;
    expect(setApiGatewayAccessLogFormat.calledWith(instance)).to.be.true;
    expect(createAndSetDeploymentUid.calledWith(instance)).to.be.true;
  });

  it('routes after:package:createDeploymentArtifacts hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('after:package:createDeploymentArtifacts')();
    expect(wrapClean.calledWith(instance)).to.be.true;
  });

  it('routes before:invoke:local:invoke hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('before:invoke:local:invoke')();
    expect(wrap.calledWith(instance)).to.be.true;
  });

  it('routes after:invoke:local:invoke hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('after:invoke:local:invoke')();
    expect(wrapClean.calledWith(instance)).to.be.true;
  });

  it('routes before:info:info hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('before:info:info')();
  });

  it('routes before:logs:logs hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('before:logs:logs')();
  });

  it('routes before:metrics:metrics hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('before:metrics:metrics')();
  });

  it('routes before:remove:remove hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('before:remove:remove')();
  });

  it('routes after:aws:deploy:finalize:cleanup hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('after:aws:deploy:finalize:cleanup')();
    expect(saveDeployment.calledWith(instance)).to.be.true;
  });

  it('routes after:remove:remove hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('after:remove:remove')();
    expect(removeDestination.calledWith(instance)).to.be.true;
    expect(saveDeployment.calledWith(instance, true)).to.be.true;
  });

  it('routes before:aws:package:finalize:saveServiceState', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('before:aws:package:finalize:saveServiceState')();
    expect(logsCollection.calledWith(instance)).to.be.true;
  });

  it('routes generate-event:generate-event hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.route('generate-event:generate-event')();
    expect(generate.calledWith(instance)).to.be.true;
  });

  it('routes asyncInit to deploy profile config', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.asyncInit();
    expect(configureDeployProfile.calledWith(instance)).to.be.true;
  });

  it('routes after:info:info hook correctly', async () => {
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.asyncInit();
    await instance.route('after:info:info')();
    expect(
      // eslint-disable-next-line no-console
      console.log.args[0][0]
    ).to.include('Run "serverless dashboard" to open the dashboard or visit ');
  });

  it('sets app & org from CLI flags if not in interactive mode', async () => {
    sls.processedInput.options.org = 'cli-flag-org';
    sls.processedInput.options.app = 'cli-flag-app';
    const instance = new ServerlessEnterprisePlugin(sls);
    await instance.asyncInit();
    expect(sls.service.org).to.equal('cli-flag-org');
    expect(sls.service.app).to.equal('cli-flag-app');
  });
});

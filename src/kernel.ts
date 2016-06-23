// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  IAjaxSettings
} from 'jupyter-js-utils';

import * as utils
  from 'jupyter-js-utils';

import {
  DisposableDelegate, IDisposable
} from 'phosphor-disposable';

import {
  ISignal, Signal, clearSignalData
} from 'phosphor-signaling';

import {
  Comm
} from './comm';

import {
  kernel
} from './ikernel';

import {
  JSONObject
} from './json';

import {
  KernelFutureHandler
} from './kernelfuture';

import * as serialize
  from './serialize';

import * as validate
  from './validate';


/**
 * The url for the kernel service.
 */
const KERNEL_SERVICE_URL = 'api/kernels';

/**
 * The url for the kernelspec service.
 */
const KERNELSPEC_SERVICE_URL = 'api/kernelspecs';


/**
 * An implementation of a kernel manager.
 */
export
class KernelManager implements kernel.IManager {
  /**
   * Construct a new kernel manager.
   *
   * @param options - The default options for kernel.
   */
   constructor(options?: kernel.IOptions) {
     this._options = utils.copy(options || {});
   }

  /**
   * Get the kernel specs.  See also [[getKernelSpecs]].
   *
   * @param options - Overrides for the default options.
   */
  getSpecs(options?: kernel.IOptions): Promise<kernel.ISpecModels> {
    return getKernelSpecs(this._getOptions(options));
  }

  /**
   * List the running kernels.  See also [[listRunningKernels]].
   *
   * @param options - Overrides for the default options.
   */
  listRunning(options?: kernel.IOptions): Promise<kernel.IModel[]> {
    return listRunningKernels(this._getOptions(options));
  }

  /**
   * Start a new kernel.  See also [[startNewKernel]].
   *
   * @param options - Overrides for the default options.
   */
  startNew(options?: kernel.IOptions): Promise<kernel.IKernel> {
    return startNewKernel(this._getOptions(options));
  }

  /**
   * Find a kernel by id.
   *
   * @param options - Overrides for the default options.
   */
  findById(id: string, options?: kernel.IOptions): Promise<kernel.IModel> {
    return findKernelById(id, this._getOptions(options));
  }

  /**
   * Connect to a running kernel.  See also [[connectToKernel]].
   *
   * @param options - Overrides for the default options.
   */
  connectTo(id: string, options?: kernel.IOptions): Promise<kernel.IKernel> {
    if (options) {
      options = this._getOptions(options);
    } else {
      options = utils.copy(this._options);
    }
    return connectToKernel(id, options);
  }

  /**
   * Get optionally overidden options.
   */
  private _getOptions(options: kernel.IOptions): kernel.IOptions {
    if (options) {
      options = utils.extend(utils.copy(this._options), options);
    } else {
      options = this._options;
    }
    return options;
  }

  private _options: kernel.IOptions = null;

}


/**
 * Find a kernel by id.
 *
 * #### Notes
 * If the kernel was already started via `startNewKernel`, we return its
 * `kernel.IModel`.
 *
 * Otherwise, if `options` are given, we attempt to find to the existing
 * kernel.
 * The promise is fulfilled when the kernel is found,
 * otherwise the promise is rejected.
 */
export
function findKernelById(id: string, options?: kernel.IOptions): Promise<kernel.IModel> {
  let kernels = Private.runningKernels;
  for (let clientId in kernels) {
    let kernel = kernels[clientId];
    if (kernel.id === id) {
      let result = { id: kernel.id, name: kernel.name };
      return Promise.resolve(result);
    }
  }
  return Private.getKernelId(id, options).catch(() => {
    return Private.typedThrow<kernel.IModel>(`No running kernel with id: ${id}`);
  });
}


/**
 * Fetch the kernel specs.
 *
 * #### Notes
 * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/kernelspecs).
 */
export
function getKernelSpecs(options?: kernel.IOptions): Promise<kernel.ISpecModels> {
  options = options || {};
  let baseUrl = options.baseUrl || utils.getBaseUrl();
  let url = utils.urlPathJoin(baseUrl, KERNELSPEC_SERVICE_URL);
  let ajaxSettings = utils.copy(options.ajaxSettings) || {};
  ajaxSettings.method = 'GET';
  ajaxSettings.dataType = 'json';

  return utils.ajaxRequest(url, ajaxSettings).then(success => {
    let err = new Error('Invalid KernelSpecs Model');
    if (success.xhr.status !== 200) {
      throw new Error('Invalid Response: ' + success.xhr.status);
    }
    let data = success.data;
    if (!data.hasOwnProperty('default') ||
        typeof data.default !== 'string') {
      throw err;
    }
    if (!data.hasOwnProperty('kernelspecs')) {
      throw err;
    }
    if (!data.kernelspecs.hasOwnProperty(data.default)) {
      throw err;
    }
    let keys = Object.keys(data.kernelspecs);
    for (let i = 0; i < keys.length; i++) {
      let ks = data.kernelspecs[keys[i]];
      validate.validateKernelSpec(ks);
    }
    return data;
  });
}


/**
 * Fetch the running kernels.
 *
 * #### Notes
 * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/kernels) and validates the response model.
 *
 * The promise is fulfilled on a valid response and rejected otherwise.
 */
export
function listRunningKernels(options?: kernel.IOptions): Promise<kernel.IModel[]> {
  options = options || {};
  let baseUrl = options.baseUrl || utils.getBaseUrl();
  let url = utils.urlPathJoin(baseUrl, KERNEL_SERVICE_URL);
  let ajaxSettings = utils.copy(options.ajaxSettings) || {};
  ajaxSettings.method = 'GET';
  ajaxSettings.dataType = 'json';
  ajaxSettings.cache = false;

  return utils.ajaxRequest(url, ajaxSettings).then(success => {
    if (success.xhr.status !== 200) {
      throw Error('Invalid Status: ' + success.xhr.status);
    }
    if (!Array.isArray(success.data)) {
      throw Error('Invalid kernel list');
    }
    for (let i = 0; i < success.data.length; i++) {
      validate.validateKernelId(success.data[i]);
    }
    return <kernel.IModel[]>success.data;
  }, Private.onKernelError);
}


/**
 * Start a new kernel.
 *
 * #### Notes
 * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/kernels) and validates the response model.
 *
 * If no options are given or the kernel name is not given, the
 * default kernel will by started by the server.
 *
 * Wraps the result in a Kernel object. The promise is fulfilled
 * when the kernel is started by the server, otherwise the promise is rejected.
 */
export
function startNewKernel(options?: kernel.IOptions): Promise<kernel.IKernel> {
  options = options || {};
  let baseUrl = options.baseUrl || utils.getBaseUrl();
  let url = utils.urlPathJoin(baseUrl, KERNEL_SERVICE_URL);
  let ajaxSettings = utils.copy(options.ajaxSettings) || {};
  ajaxSettings.method = 'POST';
  ajaxSettings.data = JSON.stringify({ name: options.name });
  ajaxSettings.dataType = 'json';
  ajaxSettings.contentType = 'application/json';
  ajaxSettings.cache = false;

  return utils.ajaxRequest(url, ajaxSettings).then(success => {
    if (success.xhr.status !== 201) {
      throw Error('Invalid Status: ' + success.xhr.status);
    }
    validate.validateKernelId(success.data);
    return new Kernel(options, success.data.id);
  }, Private.onKernelError);
}


/**
 * Connect to a running kernel.
 *
 * #### Notes
 * If the kernel was already started via `startNewKernel`, the existing
 * Kernel object info is used to create another instance.
 *
 * Otherwise, if `options` are given, we attempt to connect to the existing
 * kernel found by calling `listRunningKernels`.
 * The promise is fulfilled when the kernel is running on the server,
 * otherwise the promise is rejected.
 *
 * If the kernel was not already started and no `options` are given,
 * the promise is rejected.
 */
export
function connectToKernel(id: string, options?: kernel.IOptions): Promise<kernel.IKernel> {
  for (let clientId in Private.runningKernels) {
    let kernel = Private.runningKernels[clientId];
    if (kernel.id === id) {
      return Promise.resolve(kernel.clone());
    }
  }
  return Private.getKernelId(id, options).then(kernelId => {
    return new Kernel(options, id);
  }).catch(() => {
    return Private.typedThrow<kernel.IModel>(`No running kernel with id: ${id}`);
  });
}


/**
 * Create a well-formed Kernel Message.
 */
export
function createKernelMessage(options: kernel.IMessageOptions, content: JSONObject = {}, metadata: JSONObject = {}, buffers: (ArrayBuffer | ArrayBufferView)[] = []) : kernel.IMessage {
  return {
    header: {
      username: options.username || '',
      version: '5.0',
      session: options.session,
      msg_id: options.msgId || utils.uuid(),
      msg_type: options.msgType
    },
    parent_header: { },
    channel: options.channel,
    content: content,
    metadata: metadata,
    buffers: buffers
  };
}


/**
 * Implementation of the Kernel object
 */
class Kernel implements kernel.IKernel {
  /**
   * Construct a kernel object.
   */
  constructor(options: kernel.IOptions, id: string) {
    this.ajaxSettings = options.ajaxSettings || {};
    this._name = options.name;
    this._id = id;
    this._baseUrl = options.baseUrl || utils.getBaseUrl();
    this._wsUrl = options.wsUrl || utils.getWsUrl(this._baseUrl);
    this._clientId = options.clientId || utils.uuid();
    this._username = options.username || '';
    this._futures = new Map<string, KernelFutureHandler>();
    this._commPromises = new Map<string, Promise<kernel.IComm>>();
    this._comms = new Map<string, kernel.IComm>();
    this._createSocket();
    Private.runningKernels[this._clientId] = this;
  }

  /**
   * A signal emitted when the kernel status changes.
   */
  get statusChanged(): ISignal<kernel.IKernel, kernel.Status> {
    return Private.statusChangedSignal.bind(this);
  }

  /**
   * A signal emitted for iopub kernel messages.
   */
  get iopubMessage(): ISignal<kernel.IKernel, kernel.IMessage> {
    return Private.iopubMessageSignal.bind(this);
  }

  /**
   * A signal emitted for unhandled kernel message.
   */
  get unhandledMessage(): ISignal<kernel.IKernel, kernel.IMessage> {
    return Private.unhandledMessageSignal.bind(this);
  }

  /**
   * The id of the server-side kernel.
   *
   * #### Notes
   * This is a read-only property.
   */
  get id(): string {
    return this._id;
  }

  /**
   * The name of the server-side kernel.
   *
   * #### Notes
   * This is a read-only property.
   */
  get name(): string {
    return this._name;
  }

  /**
   * The client username.
   *
   * #### Notes
   * This is a read-only property.
   */
   get username(): string {
     return this._username;
   }

  /**
   * The client unique id.
   *
   * #### Notes
   * This is a read-only property.
   */
  get clientId(): string {
    return this._clientId;
  }

  /**
   * The current status of the kernel.
   *
   * #### Notes
   * This is a read-only property.
   */
  get status(): kernel.Status {
    return this._status;
  }

  /**
   * Get a copy of the default ajax settings for the kernel.
   */
  get ajaxSettings(): IAjaxSettings {
    return JSON.parse(this._ajaxSettings);
  }
  /**
   * Set the default ajax settings for the kernel.
   */
  set ajaxSettings(value: IAjaxSettings) {
    this._ajaxSettings = JSON.stringify(value);
  }

  /**
   * Test whether the kernel has been disposed.
   *
   * #### Notes
   * This is a read-only property which is always safe to access.
   */
  get isDisposed(): boolean {
    return this._futures === null;
  }

  /**
   * Clone the current kernel with a new clientId.
   */
  clone(): kernel.IKernel {
    let options = {
      baseUrl: this._baseUrl,
      wsUrl: this._wsUrl,
      name: this._name,
      username: this._username,
      ajaxSettings: this.ajaxSettings
    }
    return new Kernel(options, this._id);
  }

  /**
   * Dispose of the resources held by the kernel.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._status = 'dead';
    if (this._ws !== null) {
      this._ws.close();
    }
    this._ws = null;
    this._futures.forEach((future, key) => {
      future.dispose();
    });
    this._comms.forEach((comm, key) => {
      comm.dispose();
    });
    this._futures = null;
    this._commPromises = null;
    this._comms = null;
    this._status = 'dead';
    this._targetRegistry = null;
    clearSignalData(this);
    delete Private.runningKernels[this._clientId];
  }

  /**
   * Send a shell message to the kernel.
   *
   * #### Notes
   * Send a message to the kernel's shell channel, yielding a future object
   * for accepting replies.
   *
   * If `expectReply` is given and `true`, the future is disposed when both a
   * shell reply and an idle status message are received. If `expectReply`
   * is not given or is `false`, the future is resolved when an idle status
   * message is received.
   * If `disposeOnDone` is not given or is `true`, the Future is disposed at this point.
   * If `disposeOnDone` is given and `false`, it is up to the caller to dispose of the Future.
   *
   * All replies are validated as valid kernel messages.
   *
   * If the kernel status is `Dead`, this will throw an error.
   */
  sendShellMessage(msg: kernel.IMessage, expectReply=false, disposeOnDone=true): kernel.IFuture {
    if (this.status === 'dead') {
      throw new Error('Kernel is dead');
    }
    if (!this._isReady) {
      this._pendingMessages.push(msg);
    } else {
      this._ws.send(serialize.serialize(msg));
    }
    let future = new KernelFutureHandler(() => {
      this._futures.delete(msg.header.msg_id);
    }, msg, expectReply, disposeOnDone);
    this._futures.set(msg.header.msg_id, future);
    return future;
  }

  /**
   * Interrupt a kernel.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/kernels).
   *
   * The promise is fulfilled on a valid response and rejected otherwise.
   *
   * It is assumed that the API call does not mutate the kernel id or name.
   *
   * The promise will be rejected if the kernel status is `Dead` or if the
   * request fails or the response is invalid.
   */
  interrupt(): Promise<void> {
    return Private.interruptKernel(this, this._baseUrl, this.ajaxSettings);
  }

  /**
   * Restart a kernel.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/kernels) and validates the response model.
   *
   * Any existing Future or Comm objects are cleared.
   *
   * The promise is fulfilled on a valid response and rejected otherwise.
   *
   * It is assumed that the API call does not mutate the kernel id or name.
   *
   * The promise will be rejected if the request fails or the response is
   * invalid.
   */
  restart(): Promise<void> {
    this._clearState();
    this._updateStatus('restarting');
    return Private.restartKernel(this, this._baseUrl, this.ajaxSettings);
  }

  /**
   * Shutdown a kernel.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/kernels).
   *
   * The promise is fulfilled on a valid response and rejected otherwise.
   *
   * On a valid response, closes the websocket and disposes of the kernel
   * object, and fulfills the promise.
   *
   * The promise will be rejected if the kernel status is `Dead` or if the
   * request fails or the response is invalid.
   */
  shutdown(): Promise<void> {
    this._clearState();
    return Private.shutdownKernel(this, this._baseUrl, this.ajaxSettings)
    .then(() => {
      this.dispose();
    });
  }

  /**
   * Send a `kernel_info_request` message.
   *
   * #### Notes
   * See [Messaging in Jupyter](http://jupyter-client.readthedocs.org/en/latest/messaging.html#kernel-info).
   *
   * Fulfills with the `kernel_info_response` content when the shell reply is
   * received and validated.
   */
  kernelInfo(): Promise<kernel.IInfo> {
    let options: kernel.IMessageOptions = {
      msgType: 'kernel_info_request',
      channel: 'shell',
      username: this._username,
      session: this._clientId
    };
    let msg = createKernelMessage(options);
    return Private.sendKernelMessage(this, msg);
  }

  /**
   * Send a `complete_request` message.
   *
   * #### Notes
   * See [Messaging in Jupyter](http://jupyter-client.readthedocs.org/en/latest/messaging.html#completion).
   *
   * Fulfills with the `complete_reply` content when the shell reply is
   * received and validated.
   */
  complete(contents: kernel.ICompleteRequest): Promise<kernel.ICompleteReply> {
    let options: kernel.IMessageOptions = {
      msgType: 'complete_request',
      channel: 'shell',
      username: this._username,
      session: this._clientId
    };
    let msg = createKernelMessage(options, contents);
    return Private.sendKernelMessage(this, msg);
  }

  /**
   * Send an `inspect_request` message.
   *
   * #### Notes
   * See [Messaging in Jupyter](http://jupyter-client.readthedocs.org/en/latest/messaging.html#introspection).
   *
   * Fulfills with the `inspect_reply` content when the shell reply is
   * received and validated.
   */
  inspect(contents: kernel.IInspectRequest): Promise<kernel.IInspectReply> {
    let options: kernel.IMessageOptions = {
      msgType: 'inspect_request',
      channel: 'shell',
      username: this._username,
      session: this._clientId
    };
    let msg = createKernelMessage(options, contents);
    return Private.sendKernelMessage(this, msg);
  }

  /**
   * Send a `history_request` message.
   *
   * #### Notes
   * See [Messaging in Jupyter](http://jupyter-client.readthedocs.org/en/latest/messaging.html#history).
   *
   * Fulfills with the `history_reply` content when the shell reply is
   * received and validated.
   */
  history(contents: kernel.IHistoryRequest): Promise<kernel.IHistoryReply> {
    let options: kernel.IMessageOptions = {
      msgType: 'history_request',
      channel: 'shell',
      username: this._username,
      session: this._clientId
    };
    let msg = createKernelMessage(options, contents);
    return Private.sendKernelMessage(this, msg);
  }

  /**
   * Send an `execute_request` message.
   *
   * #### Notes
   * See [Messaging in Jupyter](http://jupyter-client.readthedocs.org/en/latest/messaging.html#execute).
   *
   * Future `onReply` is called with the `execute_reply` content when the
   * shell reply is received and validated. The future will resolve when
   * this message is received and the `idle` iopub status is received.
   * The future will also be disposed at this point unless `disposeOnDone`
   * is specified and `false`, in which case it is up to the caller to dispose
   * of the future.
   *
   * **See also:** [[IExecuteReply]]
   */
  execute(contents: kernel.IExecuteRequest, disposeOnDone: boolean = true): kernel.IFuture {
    let options: kernel.IMessageOptions = {
      msgType: 'execute_request',
      channel: 'shell',
      username: this._username,
      session: this._clientId
    };
    let defaults = {
      silent : false,
      store_history : true,
      user_expressions : {},
      allow_stdin : true,
      stop_on_error : false
    };
    contents = utils.extend(defaults, contents);
    let msg = createKernelMessage(options, contents);
    return this.sendShellMessage(msg, true, disposeOnDone);
  }

  /**
   * Send an `is_complete_request` message.
   *
   * #### Notes
   * See [Messaging in Jupyter](http://jupyter-client.readthedocs.org/en/latest/messaging.html#code-completeness).
   *
   * Fulfills with the `is_complete_response` content when the shell reply is
   * received and validated.
   */
  isComplete(contents: kernel.IIsCompleteRequest): Promise<kernel.IIsCompleteReply> {
    let options: kernel.IMessageOptions = {
      msgType: 'is_complete_request',
      channel: 'shell',
      username: this._username,
      session: this._clientId
    };
    let msg = createKernelMessage(options, contents);
    return Private.sendKernelMessage(this, msg);
  }

  /**
   * Send a `comm_info_request` message.
   *
   * #### Notes
   * Fulfills with the `comm_info_reply` content when the shell reply is
   * received and validated.
   */
  commInfo(contents: kernel.ICommInfoRequest): Promise<kernel.ICommInfoReply> {
    let options: kernel.IMessageOptions = {
      msgType: 'comm_info_request',
      channel: 'shell',
      username: this._username,
      session: this._clientId
    };
    let msg = createKernelMessage(options, contents);
    return Private.sendKernelMessage(this, msg);
  }

  /**
   * Send an `input_reply` message.
   *
   * #### Notes
   * See [Messaging in Jupyter](http://jupyter-client.readthedocs.org/en/latest/messaging.html#messages-on-the-stdin-router-dealer-sockets).
   */
  sendInputReply(contents: kernel.IInputReply): void {
    if (this.status === 'dead') {
      throw new Error('Kernel is dead');
    }
    let options: kernel.IMessageOptions = {
      msgType: 'input_reply',
      channel: 'stdin',
      username: this._username,
      session: this._clientId
    };
    let msg = createKernelMessage(options, contents);
    if (!this._isReady) {
      this._pendingMessages.push(msg);
    } else {
      this._ws.send(serialize.serialize(msg));
    }
  }

  /**
   * Register a comm target handler.
   *
   * @param targetName - The name of the comm target.
   *
   * @param callback - The callback invoked for a comm open message.
   *
   * @returns A disposable used to unregister the comm target.
   *
   * #### Notes
   * Only one comm target can be registered at a time, an existing
   * callback will be overidden.  A registered comm target handler will take
   * precedence over a comm which specifies a `target_module`.
   */
  registerCommTarget(targetName: string, callback: (comm: kernel.IComm, msg: kernel.ICommOpenMessage) => void): IDisposable {
    this._targetRegistry[targetName] = callback;
    return new DisposableDelegate(() => {
      delete this._targetRegistry[targetName];
    });
  }

  /**
   * Connect to a comm, or create a new one.
   *
   * #### Notes
   * If a client-side comm already exists, it is returned.
   */
  connectToComm(targetName: string, commId?: string): kernel.IComm {
    if (commId === void 0) {
      commId = utils.uuid();
    }
    let comm = this._comms.get(commId);
    if (!comm) {
      comm = new Comm(targetName, commId, this._sendCommMessage.bind(this), () => {
        this._unregisterComm(comm.commId);
      });
      this._comms.set(commId, comm);
    }
    return comm;
  }

  /**
   * Get the kernel spec associated with the kernel.
   *
   * #### Notes
   * This value is cached and only fetched the first time it is requested.
   */
  getKernelSpec(): Promise<kernel.ISpec> {
    if (this._spec) {
      return Promise.resolve(this._spec);
    }
    let name = this.name;
    let options = { baseUrl: this._baseUrl, ajaxSettings: this._ajaxSettings };
    return getKernelSpecs(options).then(ids => {
      let id = ids.kernelspecs[name];
      if (!id) {
        throw new Error(`Could not find kernel spec for ${name}`);
      }
      this._spec = id.spec;
      return this._spec;
    });
  }

  /**
   * Create the kernel websocket connection and add socket status handlers.
   */
  private _createSocket(): void {
    let partialUrl = utils.urlPathJoin(this._wsUrl, KERNEL_SERVICE_URL,
                                       utils.urlJoinEncode(this._id));
    console.log('Starting WebSocket:', partialUrl);

    let url = (
      utils.urlPathJoin(partialUrl, 'channels') +
      '?session_id=' + this._clientId
    );

    this._ws = new WebSocket(url);

    // Ensure incoming binary messages are not Blobs
    this._ws.binaryType = 'arraybuffer';

    this._ws.onmessage = (evt: MessageEvent) => { this._onWSMessage(evt); };
    this._ws.onopen = (evt: Event) => { this._onWSOpen(evt); };

    this._ws.onclose = (evt: Event) => { this._onWSClose(evt); };
    this._ws.onerror = (evt: Event) => { this._onWSClose(evt); };
  }

  /**
   * Handle a websocket open event.
   */
  private _onWSOpen(evt: Event) {
    this._reconnectAttempt = 0;
    // Allow the message to get through.
    this._isReady = true;
    // Trigger a status response.
    this.kernelInfo();
    this._isReady = false;
  }

  /**
   * Handle a websocket message, validating and routing appropriately.
   */
  private _onWSMessage(evt: MessageEvent) {
    if (this.status === 'dead') {
      // If the socket is being closed, ignore any messages
      return;
    }
    let msg = serialize.deserialize(evt.data);
    try {
      validate.validateKernelMessage(msg);
    } catch (error) {
      console.error(error.message);
      return;
    }
    if (msg.parent_header) {
      let parentHeader = msg.parent_header as kernel.IMessageHeader;
      let future = this._futures && this._futures.get(parentHeader.msg_id);
      if (future) {
        future.handleMsg(msg);
      } else {
        // If the message was sent by us and was not iopub, it is orphaned.
        let owned = parentHeader.session === this.clientId;
        if (msg.channel !== 'iopub' && owned) {
          this.unhandledMessage.emit(msg);
        }
      }
    }
    if (msg.channel === 'iopub') {
      switch (msg.header.msg_type) {
      case 'status':
        this._updateStatus(msg.content.execution_state);
        break;
      case 'comm_open':
        this._handleCommOpen(msg);
        break;
      case 'comm_msg':
        this._handleCommMsg(msg);
        break;
      case 'comm_close':
        this._handleCommClose(msg);
        break;
      }
      this.iopubMessage.emit(msg);
    }
  }

  /**
   * Handle a websocket close event.
   */
  private _onWSClose(evt: Event) {
    if (this.status === 'dead') {
      return;
    }
    // Clear the websocket event handlers and the socket itself.
    this._ws.onclose = null;
    this._ws.onerror = null;
    this._ws = null;

    if (this._reconnectAttempt < this._reconnectLimit) {
      this._updateStatus('reconnecting');
      let timeout = Math.pow(2, this._reconnectAttempt);
      console.error('Connection lost, reconnecting in ' + timeout + ' seconds.');
      setTimeout(this._createSocket.bind(this), 1e3 * timeout);
      this._reconnectAttempt += 1;
    } else {
      this._updateStatus('dead');
    }
  }

  /**
   * Handle status iopub messages from the kernel.
   */
  private _updateStatus(status: kernel.Status): void {
    this._isReady = false;
    switch (status) {
    case 'starting':
    case 'idle':
    case 'busy':
      this._isReady = true;
      break;
    case 'restarting':
    case 'reconnecting':
    case 'dead':
      break;
    default:
      console.error('invalid kernel status:', status);
      return;
    }
    if (status !== this._status) {
      this._status = status;
      Private.logKernelStatus(this);
      this.statusChanged.emit(status);
      if (status === 'dead') {
        this.dispose();
      }
    }
    if (this._isReady) {
      this._sendPending();
    }
  }

  /**
   * Send pending messages to the kernel.
   */
  private _sendPending(): void {
    // We shift the message off the queue
    // after the message is sent so that if there is an exception,
    // the message is still pending.
    while (this._pendingMessages.length > 0) {
      let msg = serialize.serialize(this._pendingMessages[0]);
      this._ws.send(msg);
      this._pendingMessages.shift();
    }
  }

  /**
   * Clear the internal state.
   */
  private _clearState(): void {
    this._isReady = false;
    this._pendingMessages = [];
    this._futures.forEach((future, key) => {
      future.dispose();
    });
    this._comms.forEach((comm, key) => {
      comm.dispose();
    });
    this._futures = new Map<string, KernelFutureHandler>();
    this._commPromises = new Map<string, Promise<kernel.IComm>>();
    this._comms = new Map<string, kernel.IComm>();
  }

  /**
   * Handle a `comm_open` kernel message.
   */
  private _handleCommOpen(msg: kernel.ICommOpenMessage): void {
    let content = msg.content;
    let promise = utils.loadObject(content.target_name, content.target_module,
      this._targetRegistry).then(target => {
        let comm = new Comm(
          content.target_name,
          content.comm_id,
          this._sendCommMessage.bind(this),
          () => { this._unregisterComm(content.comm_id); }
        );
        let response : any;
        try {
          response = target(comm, msg);
        } catch (e) {
          comm.close();
          console.error('Exception opening new comm');
          throw(e);
        }
        return Promise.resolve(response).then(() => {
          this._commPromises.delete(comm.commId);
          this._comms.set(comm.commId, comm);
          return comm;
        });
    });
    this._commPromises.set(content.comm_id, promise);
  }

  /**
   * Handle 'comm_close' kernel message.
   */
  private _handleCommClose(msg: kernel.ICommCloseMessage): void {
    let content = msg.content;
    let promise = this._commPromises.get(content.comm_id);
    if (!promise) {
      let comm = this._comms.get(content.comm_id);
      if (!comm) {
        console.error('Comm not found for comm id ' + content.comm_id);
        return;
      }
      promise = Promise.resolve(comm);
    }
    promise.then((comm) => {
      this._unregisterComm(comm.commId);
      try {
        let onClose = comm.onClose;
        if (onClose) {
          onClose(msg);
        }
        (comm as Comm).dispose();
      } catch (e) {
        console.error('Exception closing comm: ', e, e.stack, msg);
      }
    });
  }

  /**
   * Handle a 'comm_msg' kernel message.
   */
  private _handleCommMsg(msg: kernel.ICommMsgMessage): void {
    let content = msg.content;
    let promise = this._commPromises.get(content.comm_id);
    if (!promise) {
      let comm = this._comms.get(content.comm_id);
      if (!comm) {
        console.error('Comm not found for comm id ' + content.comm_id);
        return;
      } else {
        let onMsg = comm.onMsg;
        if (onMsg) {
          onMsg(msg);
        }
      }
    } else {
      promise.then((comm) => {
        try {
          let onMsg = comm.onMsg;
          if (onMsg) {
            onMsg(msg);
          }
        } catch (e) {
          console.error('Exception handling comm msg: ', e, e.stack, msg);
        }
        return comm;
      });
    }
  }

  /**
   * Send a comm message to the kernel.
   */
  private _sendCommMessage(payload: Private.ICommPayload, disposeOnDone: boolean = true): kernel.IFuture {
   let options: kernel.IMessageOptions = {
      msgType: payload.msgType,
      channel: 'shell',
      username: this.username,
      session: this.clientId
    };
    let msg = createKernelMessage(
      options, payload.content, payload.metadata, payload.buffers
    );
    return this.sendShellMessage(msg, false, disposeOnDone);
  }

  /**
   * Unregister a comm instance.
   */
  private _unregisterComm(commId: string) {
    this._comms.delete(commId);
    this._commPromises.delete(commId);
  }

  private _id = '';
  private _name = '';
  private _baseUrl = '';
  private _wsUrl = '';
  private _status: kernel.Status = 'unknown';
  private _clientId = '';
  private _ws: WebSocket = null;
  private _username = '';
  private _ajaxSettings = '{}';
  private _reconnectLimit = 7;
  private _reconnectAttempt = 0;
  private _isReady = false;
  private _futures: Map<string, KernelFutureHandler> = null;
  private _commPromises: Map<string, Promise<kernel.IComm>> = null;
  private _comms: Map<string, kernel.IComm> = null;
  private _targetRegistry: { [key: string]: (comm: kernel.IComm, msg: kernel.ICommOpenMessage) => void; } = Object.create(null);
  private _spec: kernel.ISpec = null;
  private _pendingMessages: kernel.IMessage[] = [];
}


/**
 * A private namespace for the Kernel.
 */
namespace Private {
  /**
   * A signal emitted when the kernel status changes.
   */
  export
  const statusChangedSignal = new Signal<kernel.IKernel, kernel.Status>();

  /**
   * A signal emitted for iopub kernel messages.
   */
  export
  const iopubMessageSignal = new Signal<kernel.IKernel, kernel.IMessage>();

  /**
   * A signal emitted for unhandled kernel message.
   */
  export
  const unhandledMessageSignal = new Signal<kernel.IKernel, kernel.IMessage>();

  /**
   * A module private store for running kernels.
   */
  export
  const runningKernels: { [key: string]: Kernel; } = Object.create(null);

  /**
   * Restart a kernel.
   */
  export
  function restartKernel(kernel: kernel.IKernel, baseUrl: string, ajaxSettings?: IAjaxSettings): Promise<void> {
    if (kernel.status === 'dead') {
      return Promise.reject(new Error('Kernel is dead'));
    }
    let url = utils.urlPathJoin(
      baseUrl, KERNEL_SERVICE_URL,
      utils.urlJoinEncode(kernel.id, 'restart')
    );
    ajaxSettings = ajaxSettings || { };
    ajaxSettings.method = 'POST';
    ajaxSettings.dataType = 'json';
    ajaxSettings.contentType = 'application/json';
    ajaxSettings.cache = false;

    return utils.ajaxRequest(url, ajaxSettings).then(success => {
      if (success.xhr.status !== 200) {
        throw Error('Invalid Status: ' + success.xhr.status);
      }
      validate.validateKernelId(success.data);
    }, onKernelError);
  }

  /**
   * The contents of a comm payload.
   */
  export
  interface ICommPayload {
    msgType: string;
    content: any;
    metadata: any;
    buffers?: (ArrayBuffer | ArrayBufferView)[];
  }

  /**
   * Interrupt a kernel.
   */
  export
  function interruptKernel(kernel: kernel.IKernel, baseUrl: string, ajaxSettings?: IAjaxSettings): Promise<void> {
    if (kernel.status === 'dead') {
      return Promise.reject(new Error('Kernel is dead'));
    }
    let url = utils.urlPathJoin(
      baseUrl, KERNEL_SERVICE_URL,
      utils.urlJoinEncode(kernel.id, 'interrupt')
    );
    ajaxSettings = ajaxSettings || { };
    ajaxSettings.method = 'POST';
    ajaxSettings.dataType = 'json';
    ajaxSettings.contentType = 'application/json';
    ajaxSettings.cache = false;

    return utils.ajaxRequest(url, ajaxSettings).then(success => {
      if (success.xhr.status !== 204) {
        throw Error('Invalid Status: ' + success.xhr.status);
      }
    }, onKernelError);
  }

  /**
   * Delete a kernel.
   */
  export
  function shutdownKernel(kernel: Kernel, baseUrl: string, ajaxSettings?: IAjaxSettings): Promise<void> {
    if (kernel.status === 'dead') {
      return Promise.reject(new Error('Kernel is dead'));
    }
    let url = utils.urlPathJoin(baseUrl, KERNEL_SERVICE_URL,
                                utils.urlJoinEncode(kernel.id));
    ajaxSettings = ajaxSettings || { };
    ajaxSettings.method = 'DELETE';
    ajaxSettings.dataType = 'json';
    ajaxSettings.cache = false;

    return utils.ajaxRequest(url, ajaxSettings).then(success => {
      if (success.xhr.status !== 204) {
        throw Error('Invalid Status: ' + success.xhr.status);
      }
    }, onKernelError);
  }

  /**
   * Get a full kernel id model from the server by kernel id string.
   */
  export
  function getKernelId(id: string, options?: kernel.IOptions): Promise<kernel.IOptions> {
    options = options || {};
    let baseUrl = options.baseUrl || utils.getBaseUrl();
    let url = utils.urlPathJoin(baseUrl, KERNEL_SERVICE_URL, id);
    let ajaxSettings = options.ajaxSettings || {};
    ajaxSettings.method = 'GET';
    ajaxSettings.dataType = 'json';
    ajaxSettings.cache = false;

    return utils.ajaxRequest(url, ajaxSettings).then(success => {
      if (success.xhr.status !== 200) {
        throw Error('Invalid Status: ' + success.xhr.status);
      }
      let data = success.data as kernel.IModel;
      validate.validateKernelId(data);
      return data;
    }, Private.onKernelError);
  }

  /**
   * Log the current kernel status.
   */
  export
  function logKernelStatus(kernel: kernel.IKernel): void {
    switch (kernel.status) {
    case 'idle':
    case 'busy':
    case 'unknown':
      return;
    default:
      console.log(`Kernel: ${kernel.status} (${kernel.id})`);
      break;
    }
  }

  /**
   * Handle an error on a kernel Ajax call.
   */
  export
  function onKernelError(error: utils.IAjaxError): any {
    console.error('API request failed (' + error.statusText + '): ');
    throw Error(error.statusText);
  }

  /**
   * Send a kernel message to the kernel and return the contents of the response.
   */
  export
  function sendKernelMessage(kernel: kernel.IKernel, msg: kernel.IMessage): Promise<any> {
    let future: kernel.IFuture;
    try {
      future = kernel.sendShellMessage(msg, true);
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise<any>((resolve, reject) => {
      future.onReply = (reply: kernel.IMessage) => {
        resolve(reply.content);
      };
    });
  }

  /**
   * Throw a typed error.
   */
  export
  function typedThrow<T>(msg: string): T {
    throw new Error(msg);
  }
}

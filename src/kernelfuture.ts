// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  DisposableDelegate
} from 'phosphor-disposable';

import {
  kernel
} from './ikernel';


/**
 * Implementation of a kernel future.
 */
export
class KernelFutureHandler extends DisposableDelegate implements kernel.IFuture {
  /**
   * Construct a new KernelFutureHandler.
   */
  constructor(cb: () => void, msg: kernel.IMessage, expectShell: boolean, disposeOnDone: boolean) {
    super(cb);
    this._msg = msg;
    if (!expectShell) {
      this._setFlag(KernelFutureFlag.GotReply);
    }
    this._disposeOnDone = disposeOnDone;
  }

  /**
   * Get the original outgoing message.
   */
  get msg(): kernel.IMessage {
    return this._msg;
  }

  /**
   * Check for message done state.
   */
  get isDone(): boolean {
    return this._testFlag(KernelFutureFlag.IsDone);
  }

  /**
   * Get the reply handler.
   */
  get onReply(): (msg: kernel.IShellMessage) => void {
    return this._reply;
  }

  /**
   * Set the reply handler.
   */
  set onReply(cb: (msg: kernel.IShellMessage) => void) {
    this._reply = cb;
  }

  /**
   * Get the iopub handler.
   */
  get onIOPub(): (msg: kernel.IIOPubMessage) => void {
    return this._iopub;
  }

  /**
   * Set the iopub handler.
   */
  set onIOPub(cb: (msg: kernel.IIOPubMessage) => void) {
    this._iopub = cb;
  }

  /**
   * Get the done handler.
   */
  get onDone(): () => void  {
    return this._done;
  }

  /**
   * Set the done handler.
   */
  set onDone(cb: () => void) {
    this._done = cb;
  }

  /**
   * Get the stdin handler.
   */
  get onStdin(): (msg: kernel.IStdinMessage) => void {
    return this._stdin;
  }

  /**
   * Set the stdin handler.
   */
  set onStdin(cb: (msg: kernel.IStdinMessage) => void) {
    this._stdin = cb;
  }

  /**
   * Dispose and unregister the future.
   */
  dispose(): void {
    this._stdin = null;
    this._iopub = null;
    this._reply = null;
    this._done = null;
    this._msg = null;
    super.dispose();
  }

  /**
   * Handle an incoming kernel message.
   */
  handleMsg(msg: kernel.IMessage): void {
    switch (msg.channel) {
    case 'shell':
      this._handleReply(msg as kernel.IShellMessage);
      break;
    case 'stdin':
      this._handleStdin(msg as kernel.IStdinMessage);
      break;
    case 'iopub':
      this._handleIOPub(msg as kernel.IIOPubMessage);
      break;
    }
  }

  private _handleReply(msg: kernel.IShellMessage): void {
    let reply = this._reply;
    if (reply) reply(msg);
    this._setFlag(KernelFutureFlag.GotReply);
    if (this._testFlag(KernelFutureFlag.GotIdle)) {
      this._handleDone();
    }
  }

  private _handleStdin(msg: kernel.IStdinMessage): void {
    let stdin = this._stdin;
    if (stdin) stdin(msg);
  }

  private _handleIOPub(msg: kernel.IIOPubMessage): void {
    let iopub = this._iopub;
    if (iopub) iopub(msg);
    if (kernel.isStatusMessage(msg) &&
        msg.content.execution_state === 'idle') {
      this._setFlag(KernelFutureFlag.GotIdle);
      if (this._testFlag(KernelFutureFlag.GotReply)) {
        this._handleDone();
      }
    }
  }

  private _handleDone(): void {
    if (this.isDone) {
      return;
    }
    this._setFlag(KernelFutureFlag.IsDone);
    let done = this._done;
    if (done) done();
    this._done = null;
    if (this._disposeOnDone) {
      this.dispose();
    }
  }

  /**
   * Test whether the given future flag is set.
   */
  private _testFlag(flag: KernelFutureFlag): boolean {
    return (this._status & flag) !== 0;
  }

  /**
   * Set the given future flag.
   */
  private _setFlag(flag: KernelFutureFlag): void {
    this._status |= flag;
  }

  private _msg: kernel.IMessage = null;
  private _status = 0;
  private _stdin: (msg: kernel.IStdinMessage) => void = null;
  private _iopub: (msg: kernel.IIOPubMessage) => void = null;
  private _reply: (msg: kernel.IShellMessage) => void = null;
  private _done: () => void = null;
  private _disposeOnDone = true;
}


/**
 * Bit flags for the kernel future state.
 */
enum KernelFutureFlag {
  GotReply = 0x1,
  GotIdle = 0x2,
  IsDone = 0x4,
  DisposeOnDone = 0x8,
}

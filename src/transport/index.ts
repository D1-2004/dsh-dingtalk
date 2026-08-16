/**
 * 传输层
 */
export { handleInbound, assembleAgentBody, resolveScopePeer } from './inbound.js';
export { createOutboundHandler } from './outbound.js';
export type { OutboundHandler, SessionLike, DingTalkSender, ToolsRegistryLike } from './outbound.js';
export { chunkMarkdownText } from './chunker.js';
export { OutboundBuffer } from './outbound-buffer.js';

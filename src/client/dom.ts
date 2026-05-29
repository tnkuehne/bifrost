function getElement<T extends HTMLElement>(
  id: string,
  constructor: { new (...args: never[]): T },
): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

export const remoteVideo = getElement("remoteVideo", HTMLVideoElement);
export const localVideo = getElement("localVideo", HTMLVideoElement);

export const els = {
  title: getElement("title", HTMLElement),
  statusDot: getElement("statusDot", HTMLElement),
  statusText: getElement("statusText", HTMLElement),
  statusDetail: getElement("statusDetail", HTMLElement),
  toggleDebug: getElement("toggleDebug", HTMLButtonElement),
  receiverPanel: getElement("receiverPanel", HTMLElement),
  cameraPanel: getElement("cameraPanel", HTMLElement),
  summaryPanel: getElement("summaryPanel", HTMLElement),
  cameraSummary: getElement("cameraSummary", HTMLElement),
  incomingSummary: getElement("incomingSummary", HTMLElement),
  pathSummary: getElement("pathSummary", HTMLElement),
  debugCameraPanel: getElement("debugCameraPanel", HTMLElement),
  debugPathPanel: getElement("debugPathPanel", HTMLElement),
  debugEventsPanel: getElement("debugEventsPanel", HTMLElement),
  receiverFrame: getElement("receiverFrame", HTMLElement),
  cameraFrame: getElement("cameraFrame", HTMLElement),
  cameraQr: getElement("cameraQr", HTMLImageElement),
  cameraLink: getElement("cameraLink", HTMLElement),
  obsLink: getElement("obsLink", HTMLElement),
  copyObsLink: getElement("copyObsLink", HTMLButtonElement),
  toggleFit: getElement("toggleFit", HTMLButtonElement),
  startCamera: getElement("startCamera", HTMLButtonElement),
  switchCamera: getElement("switchCamera", HTMLButtonElement),
  pageRole: getElement("pageRole", HTMLElement),
  cameraFormat: getElement("cameraFormat", HTMLElement),
  senderFormat: getElement("senderFormat", HTMLElement),
  trackState: getElement("trackState", HTMLElement),
  incomingFormat: getElement("incomingFormat", HTMLElement),
  videoElementState: getElement("videoElementState", HTMLElement),
  frameSample: getElement("frameSample", HTMLElement),
  inboundStats: getElement("inboundStats", HTMLElement),
  iceServers: getElement("iceServers", HTMLElement),
  selectedPath: getElement("selectedPath", HTMLElement),
  localCandidate: getElement("localCandidate", HTMLElement),
  remoteCandidate: getElement("remoteCandidate", HTMLElement),
  relayState: getElement("relayState", HTMLElement),
  eventLog: getElement("log", HTMLElement),
};

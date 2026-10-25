// Private routing configuration. These labels never belong in reader evidence.
export const STAGE_CONFIGURATION=Object.freeze(['smoke','pilot'].map(stage=>Object.freeze({stage})));
export const ARM_CONFIGURATION=Object.freeze(['U','T','O','P'].map(arm=>Object.freeze({arm})));

// Measurement-only preload. The actual public host/reader Worker stays in use.
import { channel } from 'node:diagnostics_channel';
import { workerData } from 'node:worker_threads';
channel('cairn.topic-member-previews.metrics').subscribe(value => workerData.previewMetricsPort.postMessage(value));

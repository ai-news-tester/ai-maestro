/**
 * Full-track analysis off the main thread. Thin wrapper only: analyzer.js has
 * no DOM dependencies, so the exact module the Node tests import runs here.
 */
import { SpectralAnalyzer } from './analyzer.js';

self.onmessage = (e) => {
  const { channels, sampleRate } = e.data;
  try {
    // analyzeFullTrack only reads these four fields plus getChannelData.
    const buffer = {
      numberOfChannels: channels.length,
      length: channels[0].length,
      sampleRate,
      duration: channels[0].length / sampleRate,
      getChannelData: (c) => channels[c],
    };
    self.postMessage({ report: SpectralAnalyzer.analyzeFullTrack(buffer) });
  } catch (err) {
    self.postMessage({ error: (err && err.message) || String(err) });
  }
};
/**
 * AudioWorkletProcessor for capturing microphone input
 * Replaces deprecated ScriptProcessorNode
 *
 * Buffers audio to 4096 samples (~256ms at 16kHz) before sending to main thread
 * to match the behavior of the previous ScriptProcessorNode
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer to accumulate audio samples (4096 samples = ~256ms at 16kHz)
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // If we have input audio data
    if (input && input.length > 0) {
      const inputChannel = input[0]; // Mono channel

      if (inputChannel && inputChannel.length > 0) {
        // Add samples to buffer
        for (let i = 0; i < inputChannel.length; i++) {
          this.buffer[this.bufferIndex] = inputChannel[i];
          this.bufferIndex++;

          // When buffer is full, send it to main thread
          if (this.bufferIndex >= this.bufferSize) {
            // Create a copy to send
            const audioDataCopy = new Float32Array(this.buffer);

            // Send audio data to main thread
            this.port.postMessage({
              audioData: audioDataCopy,
            });

            // Reset buffer
            this.bufferIndex = 0;
          }
        }
      }
    }

    // Return true to keep processor alive
    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);

export const SMOKE_SAMPLE_RATE_HZ=48_000;
export const SMOKE_DURATION_SECONDS=60;
/** Deterministic 60-second stereo PCM fixture. No customer sample data is used. */
export function fabricatedTrackingErrorWav():Buffer{
  const frames=SMOKE_SAMPLE_RATE_HZ*SMOKE_DURATION_SECONDS,channels=2,bits=16,blockAlign=channels*bits/8,dataBytes=frames*blockAlign;
  const wav=Buffer.alloc(44+dataBytes);wav.write('RIFF');wav.writeUInt32LE(36+dataBytes,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(channels,22);wav.writeUInt32LE(SMOKE_SAMPLE_RATE_HZ,24);wav.writeUInt32LE(SMOKE_SAMPLE_RATE_HZ*blockAlign,28);wav.writeUInt16LE(blockAlign,32);wav.writeUInt16LE(bits,34);wav.write('data',36);wav.writeUInt32LE(dataBytes,40);
  for(let frame=0;frame<frames;frame++){const sample=Math.round(Math.sin(2*Math.PI*1000*frame/SMOKE_SAMPLE_RATE_HZ)*0x3fff);wav.writeInt16LE(sample,44+frame*blockAlign);wav.writeInt16LE(sample,46+frame*blockAlign);}return wav;
}

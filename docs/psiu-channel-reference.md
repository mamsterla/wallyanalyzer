# PSIU Absolute Channel Reference

## Established reference — 2026-10-20

These two recordings establish the current absolute channel mapping for PSIU UID `3939383431335116002A0058` using the same cabling:

| Recording | Known source | Recorded result |
| --- | --- | --- |
| `psiu-3939383431335116002A0058-1792543664230.wav` | Test-record physical-left 1 kHz tone | Right channel, 25.0 dB dominance |
| `psiu-3939383431335116002A0058-1792543996397.wav` | Test-record opening 80 Hz tone | Right channel, 23.3 dB dominance |

Therefore, for this current PSIU/cabling state:

```text
physical left → recorded right
physical right → recorded left
```

The two checks agree and are the authoritative calibration evidence. Do not infer absolute physical channel identity from other captures without matching them to this reference.

## Provenance

| Recording | Bytes | SHA-256 |
| --- | ---: | --- |
| `1792543664230.wav` | 8,994,860 | `7714543f8fd4b639a79384cf28f7579c76d6046210e889aa9f42c9e41973aac1` |
| `1792543996397.wav` | 20,783,148 | `867b8f181115403a0cde89b3f80bfd557481ce48de5598a4dd3ba69d7fdbc67f` |

## Firmware 1.3.1 verification — 2026-10-21

Firmware 1.3.1 corrected the channel swap for PSIU UID `3939383431335116002A0058`.

| Recording | Known source | Recorded result |
| --- | --- | --- |
| `psiu-3939383431335116002A0058-1792614363406.wav` | Test-record opening 80 Hz tone | Left channel, 25.8 dB dominance |
| `psiu-3939383431335116002A0058-1792614431236.wav` | Reference-record physical-left 1 kHz track | Left channel, 26.7 dB dominance |

The post-upgrade mapping is now:

```text
physical left → recorded left
physical right → recorded right
```

Channel mapping remains durable per system/device capture context. Record firmware version and repeat this two-recording verification whenever firmware or cabling changes.

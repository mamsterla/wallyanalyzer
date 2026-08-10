# Tonearm Database

Generated local tonearm database artifacts.

## Current hydration
- tonearm models: 348
- fact/spec rows: 2969
- manufacturer research queue rows: 111
- target model queue rows: 358

## Research focus
- Work manufacturer-first, then branch into exact arm models.
- Primary focus: standalone upgrade tonearms.
- Secondary focus: high-end turntable/tonearm combos and boutique brands.

### Primary manufacturer queue
- Graham
- Kuzma
- Origin Live
- Rega
- Supatrac
- Tri-Planar

### Secondary manufacturer queue
- AMG
- Audiomods
- Basis Audio
- Dr. Feickert
- Gold Note
- Korf
- Moerch
- Music Hall
- Ortofon
- Pro-Ject
- Reed
- SAT
- Schroeder
- TechDAS
- Thales
- TW-Acustic
- VPI
- Well Tempered Lab
- Wilson Benesch

## Files
- `tonearms.db` SQLite working database
- `schema.sql` SQLite schema and preferred views
- `exports/tonearms.csv` flattened preferred export
- `exports/tonearm_specs.csv` field-level fact export
- `exports/manufacturers.csv` manufacturer export
- `exports/tonearm_models.csv` model export
- `exports/manufacturer_research_queue.csv` manufacturer-first research queue
- `exports/tonearm_research_targets.csv` queued arm-model targets by manufacturer
- `exports/manufacturer_research_summary.csv` priority + current-coverage dashboard
- `exports/model_source_audit.csv` per-model source trust and source-type audit
- `exports/models_needing_source_upgrade.csv` filtered report of models still relying on non-official sources
- `exports/manufacturer_normalization_candidates.csv` duplicate/legacy manufacturer cleanup candidates
- `exports/stereophile_2025_tonearm_gap_audit.csv` comparison of Stereophile 2025 recommended arms against current DB + queue coverage
- `exports/requested_manufacturer_gap_audit.csv` audit of additional user-requested manufacturers against current DB + queue coverage
- `exports/vinylengine_manufacturer_coverage_audit.csv` comparison of a broad manufacturer list against current DB + queue coverage
- `exports/vinylengine_missing_high_priority_manufacturers.csv` curated shortlist of notable missing manufacturers from that broader list
  - current broad-list coverage: `85 present`, `138 missing`
  - current curated high-priority missing shortlist: `14` manufacturers still unseeded
- `exports/tonearm_workbook_gap_report.csv` comparison of `data/TonearmDatabaseWTv4.xlsx` against current DB + queue, including imported queue targets and skipped rows
- `sources/` local source snapshots when available

## Notes
- Current DB mixes grouped BIGLOBE legacy rows with exact-model manual and official-source enrichments.
- Staged enrichments now include manual batches for upgrade arms, boutique arms, and combo arms through `upgrade_arms_batch_090.csv`.
- Reusable helper script `scripts/manual_ocr.py` now handles repeated ManualsLib, ManualMachine, and PDF OCR/manual extraction work during source-upgrade cleanup.
- The research queue is the planning layer for broader manufacturer coverage and exact-model follow-up.
- Current seeded primary/secondary manufacturers are now fully hydrated. `Air Tangent` active follow-up now tracks exact `2B` plus official-archive `Model 2002` and `Reference`; legacy `2A` remains in the queue only as a superseded trace row after archive follow-up failed to corroborate it as an active exact-model target. The source-upgrade report is now cleared again after adding official archived later-lineage support to `Air Tangent / 2B`.
- Stereophile 2025 gap audit now flags `18` recommended arms as queued follow-up and `4` as already covered in the DB (`AMG 9W2`, `Korf TA-SF9`, `Sorane SA-1.2`, `Rega RB330`).
- Additional user-requested manufacturer audit now promotes `Dynavector`, `Audio-Technica`, and `Fidelity Research` from backlog into explicit follow-up, and seeds new queue rows for `Vertere Acoustics`, `Michell`, `Glanz`, and `Pear Audio`.
- Easy official-source pass is now completed for `Michell` and `Glanz`.
- Harder follow-up is now partially resolved with official descriptive hydration for `Vertere Acoustics` and `J.Sikora`, while `Pear Audio` is now fully hydrated with `Cornet 1`, `Cornet 2`, and `Cornet 3` represented.
- `Dynavector / DV-501/505/507` now carries official manufacturer lineage support from the Dynavector `DV 507 MkII` page, removing it from the official-followup cleanup queue.
- `Audio-Technica` grouped legacy rows now carry stronger hifi-wiki exact-model support for the `AT-1000` and `AT-1100` families, and `Fidelity Research / FR-14/FR-24/FR-54/FR-64` now carries manual-derived support from the TNT-Audio `FR-64S` review.
- `Fidelity Research / FR-66S` and `FR-66fx` now also carry manual-mirror null-point support from the FR-60 series operating instructions, shifting both to `Stevenson` alignment classification.
- Exact `Fidelity Research / FR-64S` and `FR-64fx` rows are now represented from manual-derived review data plus FR-60-series manual-mirror support.
- Exact `Audio-Technica / AT-1005 II`, `AT-1007`, `AT-1009`, and `AT-1100` rows are now represented from hifi-wiki scanned specification pages.
- Exact `Audio-Technica / AT-1501` and `AT-1503` rows are now represented from hifi-wiki advertisement and Sound Arms references.
- Exact `Fidelity Research / FR-12` and `FR-34` now carry stronger secondary archive-index support from the hifi-wiki Fidelity Research tonearm list.
- Exact `Fidelity Research / FR-66` is now represented from the hifi-wiki tonearm list plus FR-60-series manual-mirror template data.
- New queue discovery pass added manufacturer follow-up for `Audio Creative` with target `Groovemaster 4`, expanded `Sorane` with target `TA-1` from the updated Stereophile 2025 recommended-components list, and seeded missing-manufacturer follow-up for `Acoustic Solid`, `Air Tangent`, `Alphason Designs`, `Audio Note`, `Durand`, `Goldmund`, `Koshin`, `Micro Seiki`, and `Saec`.
- `Durand / Talea` and `Durand / Tosca` are now hydrated from official manufacturer pages, and `Audio Creative / Groovemaster 4` is now represented from review plus official-family support.
- `Audio Note / Arm One/II` and `Arm Three/II` are now hydrated from official manufacturer pages with descriptive construction, mounting, bearing, wiring, and compatibility data.
- `Acoustic Solid / WTB 313 12-inch` is now represented from the user-supplied Kronos AV dealer page with published geometry and construction data.
- `Acoustic Solid / WTB 213` is now represented from the Kronos AV product page with published geometry and construction data, and `WTB 370` is now represented from dealer package pages with exact model naming plus descriptive arm support.
- `Micro Seiki / MA-505` and `MA-707` are now represented from scanned operating-manual mirrors with exact geometry, cartridge-range, and adjustment data.
- `Koshin / GST-1` and `GST-801` are now represented from archived dealer/community sources, and `Saec / WE-308SX` plus `WE-407/23` are now represented from archival geometry and product-page sources.
- Cleanup pass added official SME documentation support for `309`, `310`, `312`, `3009R`, `3010R`, `3012R`, `M2-9`, `M2-10`, `M2-12`, grouped `V/IV`, remaining legacy `3009 Series II/Improved/III/IIIS` family rows, and `EMT / 929`; also upgraded `Clearaudio / Unify 9"`, `Kuzma / Stogi`, and `Brinkmann / 10.5` from official sources.
- High-value target follow-up also hydrated `Linn / Ekos SE`, `Clearaudio / Tracer Black Carbon Fiber`, `Acoustic Signature / TA-5000 NEO`, `Acoustic Signature / TA-7000 NEO 9-inch`, `Acoustic Signature / TA-7000 NEO 12-inch`, `EMT / 909-HI`, `EMT / 912`, `Acoustical Systems / AXIOM Reference 12-inch`, `Acoustical Systems / AQUILAR Reference 10-inch`, `Schick / Schick 10.5-inch Tonearm`, `Schick / Schick 12-inch Tonearm`, `ViV Laboratory / Rigid Float HA9`, and `Wand / Master 12-inch`.
- `Acoustical Systems` target naming is now aligned to the official lineup: `AQUILAR` for the 10-inch reference arm and `AXIOM` for the 12-inch reference arm. `Wand` target naming is also aligned to the current official lineup: `Master 12-inch` rather than legacy `Master Lite 12-inch`.
- `ViV Laboratory / Rigid Float HA9` is now represented from strong distributor technical pages because a clean official manufacturer source was not surfaced during this pass.
- Cleanup pass also upgraded grouped `Ortofon / RMG-212 & RS-212`, `Ortofon / RMG-309`, and `Ortofon / SMG-212/SKG-212/AS-212` from official Ortofon historical pages plus the official RS/AS alignment recommendation PDF.
- Cleanup pass also upgraded `Rega / RB250`, `Rega / RB300`, and grouped `Rega / RB250 & RB300` from official Rega timeline and lineage pages.
- Cleanup pass also upgraded `Thorens / BTD-12S`, `Thorens / TP16II with TP-62`, and `Thorens / TP16III with TP-63` from original Thorens manual scans hosted by ManualsLib.
- Cleanup pass also upgraded grouped `Technics / EPA-100/250/500`, grouped `Technics / EPA-99 & EPA-110`, grouped `Technics / EPA-101S & EPA-121S`, and grouped `Technics / EPA-101L/101T/102L/102T/121L/121T` from original Technics manuals and component-lineup sources.
- Cleanup pass also upgraded `Sony / PUA-7`, `Sony / PUA-9`, grouped `Sony / PUA-237 & PUA-1500S`, grouped `Sony / PUA-286 & PUA-1500L`, and `Sony / PUA-1600S` from original-manual or historical Sony specification support.
- Cleanup pass also upgraded `Micro / MA-202`, `Micro / MA-303`, grouped `Micro / MA-505, MA-707, MAX-237, CF-1(dynamic)`, grouped `Micro / MA-701, CF-2 (static)`, and grouped `Micro / MAX-282 & MA-505L` from historical Micro specification or brochure support.
- Cleanup pass also upgraded grouped `Jelco / SA-250 & SA-750D (S-shape wand)`, `Jelco / SA-250st (Straight wand)`, `Jelco / SA-750LB (S-shape wand)`, `Schroeder / CB 9-inch`, `Schroeder / CB-L 12-inch`, and grouped `Schroeder / Model 2 and Model DPS` from factory-manual, mirrored-manual, or official manuals-index support.
- Cleanup pass also upgraded `Acoustic Solid / WTB 213`, `Acoustic Solid / WTB 313 12-inch`, `Acoustic Solid / WTB 370`, grouped `Denon / DA-302/304/308/1000` plus `Denon / DA-303/305/307/309/401`, `Azden / PU-402 (SYNTEC S-220)` plus grouped `Azden / PU-547 & PU-550` and `Azden / PU-549`, grouped or exact `Audio-Technica` rows for `AT-1001/1005II/1007/1009`, `AT-1005 II`, `AT-1007`, `AT-1009`, `AT-1100`, `AT-1100/1010/1120`, `AT-1501`, `AT-1501II`, `AT-1501III, IV`, `AT-1503`, `AT-1503II`, and `AT-1503III, IV, IIIa`, `Fidelity Research / FR-12`, grouped `FR-14/FR-24/FR-54/FR-64`, `FR-34`, `FR-64S`, `FR-64fx`, `FR-66`, `FR-66S`, and `FR-66fx`, grouped or exact `Saec` rows for `WE-308 (circa 1971), WE-308N(1975) & WE-308SX (1982)`, `WE-308L(circa 1978)`, `WE-308SX`, `WE-317(1982)`, `WE-407/23`, grouped `WE-407/23(1980), WE-317S & WE-4700(2019)`, `WE-506/30(1978)`, and `WE-8000/ST(circa 1984)`, grouped `Grace / G-540F/640P/704/707/714/727/945` and grouped `Grace / G-565F/660P/860F/860FB/960`, `Koshin / GST-1`, `Koshin / GST-801`, `Lustre / GST-1`, `Lustre / GST-801`, `ADC / ALT-1`, grouped `ADC / LMF-1 & LMF-2`, grouped `Excel / ES-1000 & Pro S1TA`, `Excel / ES-801`, grouped `Audio Craft / AC-30/300/3000/3300`, grouped `Audio Craft / AC-400/4000/4400`, `Micro Seiki / MA-505`, `Micro Seiki / MA-707`, `Victor (JVC) / UA-7045`, `Victor (JVC) / UA-7082`, `Pioneer / PA-100`, `Pioneer / PA-1000`, `Yamaha / YSA-1`, `Yamaha / YSA-2 pure straight arm`, grouped `SUMIKO / MMT/FT-3/FT-4`, `SUMIKO / Premier FT-3`, grouped `Mayware / Formula 4 MK III/IV/V`, `Mayware / Formula 4 Model PL S4/D`, grouped `Helius / Aureus & Scorpio`, `Helius / Orion`, grouped `Ikeda / IT-345 & IT-245`, `Ikeda / IT-407`, grouped `Stax / UA-7/7N/7cfN/9N`, grouped `Stax / UA-70/70N/90N`, `Mission / 774 Original`, `Hadcock / GH228`, `Hadcock / GH242 Special Edition`, `Supex / 6140`, `Alphason / Opal/Delta/Xenon/HR100S`, exact `Alphason / HR-100S`, exact `Alphason / HR-100MCS`, `AudioQuest / PT-6/7/8/9`, `Empire / 980 & 990`, `Infinity / Black Widow`, `Linn / Akito/Basik/Ittok/Ekos`, `Magnepan / Unitrac-1`, `Moerch / DP-6 & UP-4`, `Naim / Aro`, `Roksan / Artemiz/Tabriz`, `Sound / ST-14/ST-14S`, `Zeta / Zeta`, `Immedia / RPM-2`, `Tri-Planar / Tri-Planar MKIV Ultimate`, `Decca / International & Professional...`, `Dr. Feickert / Straight-10`, `Graham / Model 1.5t`, `Manticore / Magician 12inch`, `Manticore / Musician/Magician`, `Odyssey / RP1-XG & RP1 Gold`, `Syrinx / PU-2 ... / PU-3 ...`, `ViV Laboratory / Rigid Float HA9`, `Wilson Benesch / ACT2 & ACT 0.5`, `Keith Monks / M9BA Laboratory Arm MKIII`, `RS-Lab / Alternative alignment (underhang)`, `Logic / datum S`, `Guya / STO-140`, `Belcanto / Unipivot 10"`, `Belcanto / Unipivot 12"`, `Satin / AR-1/1M/1S`, grouped `Breuer / Type 5A`, `Type 6A`, `Type 7 & 8`, `Kuzma / Safir 9`, `VPI / 12-inch FatBoy gimbaled`, `Korf / TA-SF9R`, `TW-Acustic / Raven 12-inch`, `Sorane / TA-1`, `Pear Audio / Cornet 3`, `Goldmund / T3F`, and `Goldmund / T5` from official manufacturer historical pages, official history support, mirrored legacy-manual library support, period manufacturer advertisement support, official distributor support, or official period compatibility pages. The unsupported legacy `JML Co. / TA-3A` row was then removed after period-source follow-up indicated JML Company was an alignment-protractor vendor rather than a confirmed tonearm maker.
- `VPI / JMW-10.5` and `VPI / JMW-10.5i` now have official-source support from VPI pages/manuals and drop out of the source-upgrade queue.
- `Air Tangent / 2B` is now represented from exact archival dealer evidence plus period family-review support plus official archived later-lineage support from the Airtangent/Caaltech 2002MKII page metadata, `Air Tangent / Model 2002` and `Air Tangent / Reference` are represented from archived official manufacturer homepages plus family review support, and legacy `2A` has been superseded in active queue tracking after archive follow-up failed to corroborate it as a current exact-model target.
- Arm height remains optional; geometry, mass, cartridge range, and mount data stay ahead of it in priority.
- `null_alignment_type` is now included in the preferred export and backfilled on a best-effort basis from explicit source language, null-point pairs, or derived geometry.
- Current backfill distribution is `Baewald=63`, `Loefgren=7`, `Stevenson=16`, `Other=144`, `Unknown=70`.
- Current `models_needing_source_upgrade.csv` backlog is now `0` again after adding official archived later-lineage support to `Air Tangent / 2B`.
- `sync_tonearm_research_queue()` and `enrich_tonearm_database()` now both pre-drop exported views before reapplying schema, removing recurring `view preferred_tonearm_specs already exists` failures during maintenance runs.
- `import_tonearm_workbook_gaps()` and CLI `wally-import-tonearm-workbook-gaps` now compare the user workbook `data/TonearmDatabaseWTv4.xlsx` against current models and queued targets, canonicalize known manufacturer aliases, skip obvious non-tonearm rows, and seed missing coverage into the research queue without adding low-trust fact rows or reopening the source-upgrade backlog.
- Current workbook-gap reconciliation now skips `122` rows already queued, `73` rows already represented in `tonearm_models`, `21` workbook rows identified as non-tonearm turntables/integrated decks, and `6` workbook duplicates.
- Workbook-driven exact-model follow-up already promoted `Rega / RB2000`, `RB220`, `RB3000`, `RB700`, and `RB880` into hydrated DB coverage from official Rega pages, timeline support, and RB2000 manual-mirror support via `upgrade_arms_batch_091.csv`.
- Workbook-driven exact-model follow-up also promoted `Jelco / SA 250`, `SA 250ST`, `SA 750D`, `SA 750DB`, `SA 750E`, and `SA 750L` into hydrated DB coverage from accepted official-distributor support via `upgrade_arms_batch_092.csv`, while preserving `models_needing_source_upgrade = 0`.
- Workbook-driven exact-model follow-up then promoted `Jelco / TK 850S`, `TK 850L`, `TK 950S`, and `TK 950L` into hydrated DB coverage from exact dealer pages plus accepted current distributor continuity support via `upgrade_arms_batch_093.csv`.
- Clearaudio workbook follow-up then represented exact `Clarify`, `Tracer`, and `Verify` from exact dealer pages plus official manufacturer family support via `upgrade_arms_batch_094.csv`.
- Clearaudio workbook follow-up now also promoted exact `Concept`, `Magnify`, `Satisfy Kardan`, `Unify 10-inch`, `Unify 12-inch`, `Unify 14-inch`, `Universal 9-inch`, and `Universal 12-inch` via `upgrade_arms_batch_095.csv`, moving `Clearaudio` to `hydrated` while preserving `models_needing_source_upgrade = 0`.
- Workbook follow-up now also promoted remaining classic `Jelco / SA 200`, `SA 250BV`, `SA 50`, and `SA 50ST` via `upgrade_arms_batch_096.csv`, leaving all current Jelco workbook targets hydrated while preserving `models_needing_source_upgrade = 0`.
- Origin Live workbook follow-up now also promoted exact `Agile`, `Encounter`, `Illustrious`, `Conquerer` workbook spelling variant for official `Conqueror`, `Enterprise`, `Renown`, and generic workbook length-option targets `9-inch`, `9.5-inch`, `10-inch`, and `12-inch` via `upgrade_arms_batch_097.csv` and `upgrade_arms_batch_098.csv`, moving `Origin Live` to `hydrated` while preserving `models_needing_source_upgrade = 0`.
- User-requested manufacturer `Rabco` is now both seeded and hydrated in queue tracking, with `SL-8` and `SL-8E` represented via `upgrade_arms_batch_099.csv` using archival original-manual family support plus technical archive exact-model support.
- Wand workbook follow-up now also promoted exact `9.5in`, `10.3in`, and `12in` variants via `upgrade_arms_batch_100.csv` from official Design Build Listen lineup support, moving `Wand` to `hydrated` while preserving `models_needing_source_upgrade = 0`.
- Audio Origami workbook follow-up now also promoted `PU7` via `upgrade_arms_batch_101.csv` from the current official PU7 GTS page as accepted exact-family continuity support.
- Avid workbook follow-up now also promoted `Nexus` via `upgrade_arms_batch_102.csv` from the official AVID Nexus page, and workbook non-tonearm filters were extended so `Avid / Acutus` and `Vertere Acoustics / SG-1` are removed from active tonearm follow-up as turntable rows.

# Native SIGTRAP analysis — 2026-10-31

## Confirmed result

The captured LocalCode main-process crash is a V8 template serial-number range-check
failure during Electron IPC event construction. It is not a GPU frame in this dump.

Evidence:

- Dump: `78ca1d59-93ce-4a5d-a6ed-ea14be06e344.dmp`, 327,952 bytes.
- PID/thread: 2313541; timestamp 2026-10-31 18:31:26 UTC (14:31:26 local).
- Process uptime: 12,824 seconds, approximately 3 hours 34 minutes.
- Signal: SIGTRAP / SI_KERNEL.
- Electron symbols match the dump debug ID exactly:
  `B71753DFA6A0A2AF0138FF5074203ECD0` (Electron 42.4.0 Linux x64).

Crashing-thread call chain, youngest first:

1. `v8::internal::InstantiateFunction` — `bit-field.h:80`.
2. `v8::internal::InstantiateObject` — `api-natives.cc:54`.
3. `v8::ObjectTemplate::NewInstance` — `api-natives.cc:514`.
4. `gin::Converter<gin_helper::AccessorValue<content::RenderFrameHost*>>::ToV8`
   — `frame_converter.cc:61`.
5. `electron::ElectronApiIPCHandlerImpl::MakeIPCEvent`.
6. `electron::ElectronApiIPCHandlerImpl::Invoke`
   — `electron_api_ipc_handler_impl.cc:68`.
7. Mojo IPC dispatch and the main-thread message pump.

## Binary and version-pinned source verification

The binary compares the assigned serial with `0x20000000` at offset `0x366bc79`
and branches on greater-than-or-equal to `0x366cb25`, an `int3` instruction.
The saved RIP is `0x366cb26` relative to the module, immediately after that trap.
Captured RCX and RDX are both `0x20000000`.

Electron 42.4.0 pins Chromium 148.0.7778.254, whose V8 revision is
`0b1a7b33935f88a225ca32de62a13478f329b625`.
In that revision:

- `templates.tq` gives `TemplateInfoFlags.serial_number` only 29 bits.
- `templates-inl.h` assigns `Heap::GetNextTemplateSerialNumber()` into that field.
- `heap-inl.h` rolls the serial counter over at `Smi::kMaxValue`, not at the
  smaller 29-bit field maximum. The installed binary compares that rollover against
  `0x3fffffff`, but traps on storage at `0x20000000`.
- `bit-field.h:80` executes `CHECK(is_valid(value))` for the integer field.

Electron's `frame_converter.cc:57–61` creates a fresh ObjectTemplate for each
frame accessor wrapper. `MakeIPCEvent` constructs this wrapper while defining
the lazy `senderFrame` property, before dispatching the invoke to JavaScript.
Therefore this is not an exception thrown by a LocalCode IPC handler and cannot
be caught with a handler-level JavaScript try/catch.

Upstream report matching this mechanism:
https://github.com/electron/electron/issues/53380
The report describes exhaustion after approximately 2^28 renderer-to-main IPC
messages (two template serials per message), with confirmations including Linux.
Follow-up verification: Electron 42.11.2 is the first fixed 42.x release. Its release
notes identify backport #53419 (merged 2026-09-02); its tagged source replaces the
frame-wrapper ObjectTemplate with a BigInt token. 42.11.1 retains the vulnerable
implementation. 42.11.18 also contains the fix and is now pinned/installed locally.
https://github.com/electron/electron/releases/tag/v42.11.2
https://github.com/electron/electron/pull/53419

## Remaining application-level question

The dump proves the fatal counter value and call chain. It does not identify the
IPC channel or explain all serial allocations preceding the crash. The known IPC-only
reproducer threshold would imply roughly 21,000 messages/second averaged over this
run; this is a conditional estimate, not a measured LocalCode message rate.

Follow-up live measurement on patched Electron 42.11.18 establishes the application
trigger: in 50.087 seconds, browser:set-bounds produced 1,553,272 out of 1,553,303
registered invokes. The last 10-second window averaged 32,981 invokes/second.
BrowserSessionManager.setBounds emitted state for unchanged bounds; the renderer
onBrowserEvent listener immediately synchronized the same bounds, creating an IPC
feedback loop while idle. Two regression tests reproduced this. Unchanged normalized
bounds now return success without emitting state, updating timestamps, or reapplying
view bounds. A follow-up measurement validates the reduction; diagnostics remain opt-in.

After the fix: 7 bounds invokes / 36 total in 50.125 seconds, followed by four
consecutive 10-second idle samples with zero calls. The live window remained mapped,
not hidden, and native Wayland. This is direct before/after evidence for the application
feedback loop; it is not a claim of exhaustive long-duration or interaction testing.

Validation: targeted tests passed 12/12, including a real isolated SIGTRAP dump.
Final full suite: 206 passed, one existing renderer tool-list contract failure, one
opt-in native test skipped. Strata was deliberately excluded from this follow-up.

## Machine freeze: separate kernel evidence

Previous-boot kernel logs show global OOM at 14:26:54. The kernel killed process
4029158 (`strata`), reporting anonymous RSS 42,831,800 KiB (about 40.8 GiB),
before Electron's main-process crash at 14:31:26. This establishes memory exhaustion
during that period. It does not establish that the SIGTRAP caused the machine freeze,
or fully explain the later freeze/reboot. No NVIDIA Xid or lockup entry was found in
the filtered previous-boot kernel evidence inspected.

## Analysis safety and next steps

- Dump stayed local and untouched; no Electron instance was started.
- A checksum-verified rust-minidump stackwalker v0.27.0 and matching official Electron
  symbols were downloaded into `/tmp/localcode-native-analysis`.
- Local symbolication ran at low priority with a 90-second bound. Human-readable
  stack reports remain there; temporary files may disappear at reboot.
- Verify an upstream patched Electron release or native template-reuse patch before
  changing dependencies. Independently measure IPC rates without logging payloads,
  and deduplicate/coalesce repeated bounds calls if measurements justify it.
- Do not treat GPU flags as a remedy for this demonstrated template-overflow crash.
- Investigate `strata` memory growth separately before another long workload.

## Analysis TODO ledger

- [x] AI-001: Check reboot/resource state and previous-boot kernel evidence.
- [x] AI-002: Extract stack using exactly matching Electron native symbols.
- [x] AI-003: Verify trap instruction, counter range, and matching upstream report;
  separate established causes from unmeasured application workload and freeze hypotheses.

Analysis-only working-tree report; no application fix or dependency change made.
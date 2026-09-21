import { useState } from "react";
import { useJarvis } from "@core";
import { useHoldToTalk } from "./ui/useHoldToTalk.js";
import { Deck, type Slide } from "./ui/deck/Deck.js";
import { Cmd } from "./ui/displays/Cmd.js";
import { Breath } from "./ui/displays/Breath.js";
import { Login } from "./ui/displays/Login.js";
import { Noc } from "./ui/displays/Noc.js";

/**
 * Cockpit is one arrangement of the core: a four-display horizontal deck.
 * All data and verbs come from useJarvis; everything below this line is
 * layout, navigation and chrome, which is exactly what a theme owns.
 */
export function App() {
  const j = useJarvis();
  const [slide, setSlide] = useState<Slide>(0);

  // Hold Space to talk from any room that has a cmd bar — the login gate has
  // its own keyboard semantics and no way to send a turn.
  useHoldToTalk({
    enabled: slide !== 0,
    recording: j.recording,
    busy: j.busy,
    sttOk: j.status.stt,
    onStart: j.startPtt,
    onStop: j.stopPtt,
    onInterrupt: j.interrupt,
  });

  const turnProps = {
    busy: j.busy,
    recording: j.recording,
    sttOk: j.status.stt,
    speaking: j.speaking,
    onSubmit: j.send,
    onPttStart: j.startPtt,
    onPttStop: j.stopPtt,
    onInterrupt: j.interrupt,
  };

  return (
    <Deck index={slide} onIndex={setSlide}>
      <Login onEnter={() => setSlide(1)} active={slide === 0} />
      <Breath
        health={j.health}
        unreachable={j.status.unreachable}
        pulse={j.pulse}
        messages={j.messages}
        confirm={j.confirm}
        active={slide === 1}
        {...turnProps}
      />
      <Cmd
        greeting={j.greeting}
        blurb={j.blurb}
        briefing={j.briefing}
        messages={j.messages}
        confirm={j.confirm}
        pulse={j.pulse}
        live={j.status.live}
        memoryFacts={j.status.memoryFacts}
        sessionAt={j.sessionAt}
        onRefetchSession={() => {
          // The theme owns navigation; refetchSession has no slide side effect.
          setSlide(2);
          j.refetchSession();
        }}
        onConfirm={() => j.answerConfirm(true)}
        onCancel={() => j.answerConfirm(false)}
        {...turnProps}
      />
      <Noc live={j.status.live} pulse={j.pulse} confirm={j.confirm} {...turnProps} />
    </Deck>
  );
}

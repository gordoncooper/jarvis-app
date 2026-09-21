import { useState } from "react";
import { useJarvis } from "@core";
import { Deck, type Slide } from "./ui/deck/Deck.js";
import { Cmd } from "./ui/displays/Cmd.js";
import { Earth } from "./ui/displays/Earth.js";
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

  const turnProps = {
    busy: j.busy,
    recording: j.recording,
    sttOk: j.status.stt,
    onSubmit: j.send,
    onPttStart: j.startPtt,
    onPttStop: j.stopPtt,
  };

  return (
    <Deck index={slide} onIndex={setSlide}>
      <Login onEnter={() => setSlide(1)} active={slide === 0} />
      <Earth
        health={j.health}
        unreachable={j.status.unreachable}
        pulse={j.pulse}
        toast={j.lastTurn}
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

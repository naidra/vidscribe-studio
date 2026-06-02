import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { TranscriptEditor } from "./TranscriptEditor";
import type { Token } from "@/lib/transcript";

const tokens: Token[] = [
  { id: 0, segmentId: 0, text: "One ", start: 0, end: 1, deleted: false },
  { id: 1, segmentId: 0, text: "two ", start: 1, end: 2, deleted: false },
  { id: 2, segmentId: 0, text: "three ", start: 2, end: 3, deleted: false },
  { id: 3, segmentId: 0, text: "four", start: 3, end: 4, deleted: false },
];

function Harness() {
  const [currentTokens, setCurrentTokens] = useState(tokens);

  return (
    <TranscriptEditor
      videoUrl="video.mp4"
      fileName="video.mp4"
      duration={4}
      tokens={currentTokens}
      onChange={setCurrentTokens}
      onExport={vi.fn()}
      exporting={false}
      exportProgress={0}
      onReset={vi.fn()}
    />
  );
}

describe("TranscriptEditor", () => {
  beforeAll(() => {
    HTMLMediaElement.prototype.load = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("extends the clicked word state across a shift-clicked range", () => {
    render(<Harness />);

    fireEvent.click(screen.getByText("two"));
    fireEvent.click(screen.getByText("four"), { shiftKey: true });

    expect(screen.getByText("One")).not.toHaveClass("deleted");
    expect(screen.getByText("two")).toHaveClass("deleted");
    expect(screen.getByText("three")).toHaveClass("deleted");
    expect(screen.getByText("four")).toHaveClass("deleted");

    fireEvent.click(screen.getByText("three"));
    fireEvent.click(screen.getByText("two"), { shiftKey: true });

    expect(screen.getByText("two")).not.toHaveClass("deleted");
    expect(screen.getByText("three")).not.toHaveClass("deleted");
    expect(screen.getByText("four")).toHaveClass("deleted");
  });
});

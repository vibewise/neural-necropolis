import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectionPanel } from "./ConnectionPanel";

describe("ConnectionPanel", () => {
  it("submits the edited API base", () => {
    const onSave = vi.fn();

    render(
      <ConnectionPanel
        apiBase="http://127.0.0.1:3000"
        onSave={onSave}
        onReset={() => {}}
        errorMessage={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("http://127.0.0.1:3000"), {
      target: { value: "http://example.test:9999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save API Base" }));

    expect(onSave).toHaveBeenCalledWith("http://example.test:9999");
  });

  it("invokes reset when requested", () => {
    const onReset = vi.fn();

    render(
      <ConnectionPanel
        apiBase="http://127.0.0.1:3000"
        onSave={() => {}}
        onReset={onReset}
        errorMessage={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reset To Local Default" }),
    );

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

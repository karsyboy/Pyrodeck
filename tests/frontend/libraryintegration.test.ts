import { describe, expect, it } from "vitest";
import { streamActionIndex } from "../../src/lib/libraryintegration";

describe("separate Steam library action", () => {
  it("adds a sibling after the native panel without changing Play, Install or their handlers", () => {
    const play = { text: "Play", onClick: () => "local launch" };
    const install = { text: "Install", onClick: () => "local installation" };
    const native = Object.freeze({ props: Object.freeze({ overview: { appid: 620 }, onShowLaunchingDetails: () => {}, children: [play, install] }) });
    const sections = [native, { props: { id: "hltb-for-deck" } }];
    const index = streamActionIndex(sections);
    expect(index).toBe(1);
    const stream = { props: { id: "pyrodeck" } };
    sections.splice(index!, 0, stream);
    expect(sections[0]).toBe(native);
    expect(native.props.children).toEqual([play, install]);
    expect(play.onClick()).toBe("local launch");
    expect(install.onClick()).toBe("local installation");
  });
  it("fails closed for an unknown Steam tree and refuses duplicate insertion", () => {
    expect(streamActionIndex([{ props: { id: "new-steam-panel" } }])).toBeNull();
    expect(streamActionIndex([{ props: { overview: {}, onShowLaunchingDetails: () => {} } }, { key: "pyrodeck" }])).toBeNull();
  });
});

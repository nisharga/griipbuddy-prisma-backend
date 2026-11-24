import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, resetDb, seedBasics } from "./helpers";

/** Home page hero videos: public list + admin add / save all / edit / delete. */
describe("CMS hero section", () => {
  let token: string;
  const url = "/api/v1/cms/hero-section";
  const video = (n: number) => ({
    title: `Video ${n}`,
    video_url: `uploads/video-${n}.mp4`,
    thumbnail_url: `uploads/poster-${n}.jpg`,
    button: { enabled: true, text: "Shop now", redirect_route: "/products" },
  });

  beforeAll(async () => {
    await resetDb();
    token = (await seedBasics()).token;
  });

  it("POST adds a video (staff only), GET lists them in order", async () => {
    expect((await api().post(url).send(video(1))).status).toBe(401);

    const created = await api().post(url).set(auth(token)).send(video(1));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      _id: expect.any(String),
      video_url: "uploads/video-1.mp4",
      position: 1,
    });

    await api().post(url).set(auth(token)).send(video(2));
    const list = await api().get(url); // public
    expect(list.status).toBe(200);
    expect(list.body.data.map((s: { title: string }) => s.title)).toEqual(["Video 1", "Video 2"]);
    expect(list.body.data[0].button).toEqual({
      enabled: true,
      text: "Shop now",
      redirect_route: "/products",
    });
  });

  it("rejects a missing video and more than 3 videos", async () => {
    const noVideo = await api().post(url).set(auth(token)).send({ title: "x" });
    expect(noVideo.status).toBe(400);

    await api().post(url).set(auth(token)).send(video(3));
    const fourth = await api().post(url).set(auth(token)).send(video(4));
    expect(fourth.status).toBe(400);
    expect(fourth.body.message).toMatch(/up to 3/);
  });

  it("PUT saves the whole list: updates, adds and removes", async () => {
    const [first, second] = (await api().get(url)).body.data;

    const res = await api()
      .put(url)
      .set(auth(token))
      .send({
        hero_section: [
          { ...video(2), _id: second._id, title: "Now first", position: 1 },
          { ...video(9), position: 2 }, // new
          { ...video(1), _id: first._id, thumbnail_url: undefined, position: 3 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { title: string }) => s.title)).toEqual(["Now first", "Video 9", "Video 1"]);
    expect(res.body.data[0]._id).toBe(second._id);
    expect(res.body.data[2].thumbnail_url).toBeNull();
  });

  it("PATCH edits one video, DELETE removes it", async () => {
    const [slide] = (await api().get(url)).body.data;

    const edited = await api().patch(`${url}/${slide._id}`).set(auth(token)).send({ title: "Edited" });
    expect(edited.body.data).toMatchObject({ title: "Edited", video_url: "uploads/video-2.mp4" });

    expect((await api().delete(`${url}/${slide._id}`).set(auth(token))).status).toBe(200);
    expect((await api().delete(`${url}/${slide._id}`).set(auth(token))).status).toBe(404);
    expect((await api().get(url)).body.data).toHaveLength(2);
  });
});

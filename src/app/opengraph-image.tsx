import { ImageResponse } from "next/og";

export const alt = "Voxandra | Live Voice Translation for Business Calls";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #7C3AED 0%, #2E1065 100%)",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -160,
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -200,
            left: -140,
            width: 480,
            height: 480,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.06)",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 108,
              height: 108,
              borderRadius: 28,
              background: "rgba(255,255,255,0.16)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="60" height="60" viewBox="0 0 72 72" fill="none">
              <path
                d="M20.75 26.15C20.75 22.671 25.3021 21.3733 27.1321 24.3303L36.0717 38.7906L44.8843 24.4037C46.7041 21.4358 51.2675 22.7105 51.2848 26.1903L51.2948 28.2154C51.3005 29.3519 50.986 30.4671 50.3881 31.4337L38.8796 50.0334C37.5651 52.1578 34.4754 52.1652 33.1508 50.0471L21.6769 31.6992C21.0629 30.7174 20.75 29.5829 20.75 28.4253V26.15Z"
                fill="white"
              />
            </svg>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 96,
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: -2,
            }}
          >
            Voxandra
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 32,
            fontSize: 34,
            fontWeight: 500,
            color: "rgba(255,255,255,0.82)",
          }}
        >
          Speak your language. They hear theirs.
        </div>
      </div>
    ),
    { ...size }
  );
}

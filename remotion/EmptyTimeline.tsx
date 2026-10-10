import { AbsoluteFill } from "remotion";

// Placeholder composition for the preview. Real clips and captions arrive in later milestones.
export const EmptyTimeline: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b0b0d",
        alignItems: "center",
        justifyContent: "center",
        color: "#6b6b74",
        fontFamily: "system-ui, sans-serif",
        fontSize: 42,
      }}
    >
      Empty timeline
    </AbsoluteFill>
  );
};

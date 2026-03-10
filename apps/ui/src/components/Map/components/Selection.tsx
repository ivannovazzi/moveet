// import { useContext, useEffect, useState } from "react";
// import { MapContext } from "../providers/contexts";

// export default function Selection() {
//   const { map } = useContext(MapContext);
//   // draws a selection box on the map in light grey with a dashed border
//   const [start, setStart] = useState({ x: 0, y: 0 });
//   const [end, setEnd] = useState({ x: 0, y: 0 });
//   const [selecting, setSelecting] = useState(false);

//   const handleMouseDown = (e: MouseEvent) => {
//     if (!map) return;
//     setSelecting(true);
//     const rect = map.getBoundingClientRect();
//     const x = e.clientX - rect.left;
//     const y = e.clientY - rect.top;
//     setStart({ x, y });
//   };

//   const handleMouseMove = (e: MouseEvent) => {
//     if (!map) return;
//     const rect = map.getBoundingClientRect();
//     const x = e.clientX - rect.left;
//     const y = e.clientY - rect.top;
//     setEnd({ x, y });
//   };

//   const handleMouseUp = () => {
//     setSelecting(false);
//   };
//   useEffect(() => {
//     if (!map) return;
//     map.addEventListener("mousedown", handleMouseDown);
//     map.addEventListener("mousemove", handleMouseMove);
//     map.addEventListener("mouseup", handleMouseUp);
//     return () => {
//       map.removeEventListener("mousedown", handleMouseDown);
//       map.removeEventListener("mousemove", handleMouseMove);
//       map.removeEventListener("mouseup", handleMouseUp);
//     };
//   }, [map]);

//   const style = {
//     fill: "none",
//     stroke: "lightgrey",
//     strokeWidth: 1,
//     strokeDasharray: 4,
//   };

//   return (
//     <div
//       {...{
//         position: "absolute",
//         left: 0,
//         top: 0,
//         x: Math.min(start.x, end.x),
//         y: Math.min(start.y, end.y),
//         width: Math.abs(start.x - end.x),
//         height: Math.abs(start.y - end.y),
//       }}
//       style={style}
//     />
//   );
// }

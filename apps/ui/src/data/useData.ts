import { useContext } from "react";
import { ClientDataContext } from "./context";

export default function useData() {
  return useContext(ClientDataContext);
}

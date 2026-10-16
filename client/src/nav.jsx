import { createContext, useContext } from "react";

export const NavCtx = createContext(null);
export const useNav = () => useContext(NavCtx);

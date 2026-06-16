import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import directoriesRouter from "./directories";
import sessionsRouter from "./sessions";
import uploadRouter from "./upload";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Public
router.use(healthRouter);
// /auth/login + /auth/logout are public; /auth/me + change-password guard themselves
router.use(authRouter);
// Admin user management (self-guarded with requireAuth + requireAdmin)
router.use(usersRouter);

// Everything below requires an authenticated session
router.use(requireAuth);
router.use(directoriesRouter);
router.use(sessionsRouter);
router.use(uploadRouter);

export default router;

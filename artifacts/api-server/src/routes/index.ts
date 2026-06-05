import { Router, type IRouter } from "express";
import healthRouter from "./health";
import directoriesRouter from "./directories";
import sessionsRouter from "./sessions";
import uploadRouter from "./upload";

const router: IRouter = Router();

router.use(healthRouter);
router.use(directoriesRouter);
router.use(sessionsRouter);
router.use(uploadRouter);

export default router;

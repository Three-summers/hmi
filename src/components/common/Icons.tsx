/**
 * 通用图标组件
 *
 * 统一从 `react-icons/md`（Material Design Icons）导入，确保视觉一致性，
 * 同时避免在各组件中散落硬编码 SVG。
 */

import {
    MdAccountCircle,
    MdAdd,
    MdBuild,
    MdCalendarToday,
    MdCheck,
    MdClose,
    MdDashboard,
    MdDelete,
    MdDoneAll,
    MdEdit,
    MdExitToApp,
    MdFileUpload,
    MdSave,
    MdFullscreen,
    MdHelpOutline,
    MdInfo,
    MdInsertDriveFile,
    MdLanguage,
    MdLink,
    MdListAlt,
    MdNotificationsActive,
    MdNoteAdd,
    MdPalette,
    MdPause,
    MdPerson,
    MdPlayArrow,
    MdPublic,
    MdRefresh,
    MdRestore,
    MdSecurity,
    MdSettings,
    MdShowChart,
    MdStop,
    MdUsb,
    MdWarning,
    MdZoomIn,
} from "react-icons/md";

// 命令按钮（CommandPanel）兼容层：保持历史导出名不变
export const AddIcon = MdAdd;
export const PlayIcon = MdPlayArrow;
export const StopIcon = MdStop;
export const PauseIcon = MdPause;
export const RefreshIcon = MdRefresh;
export const NewFileIcon = MdNoteAdd;
export const EditIcon = MdEdit;
export const DeleteIcon = MdDelete;
export const FileIcon = MdInsertDriveFile;
export const SaveIcon = MdSave;
export const ResetIcon = MdRestore;
export const CheckAllIcon = MdDoneAll;
export const CloseIcon = MdClose;
export const ExportIcon = MdFileUpload;
export const SettingsIcon = MdSettings;
export const ConnectIcon = MdLink;
export const WarningIcon = MdWarning;

// 通用/布局类图标
export const HelpIcon = MdHelpOutline;
export const LanguageIcon = MdLanguage;
export const PaletteIcon = MdPalette;
export const LayoutIcon = MdDashboard;
export const LayoutRightIcon = MdDashboard;
export const InfoIcon = MdInfo;
export const SerialIcon = MdUsb;
export const NetworkIcon = MdPublic;
export const LogIcon = MdListAlt;
export const ChartIcon = MdShowChart;

// TitlePanel / CommandPanel 需要的图标（供后续任务替换内联 SVG）
export const DateIcon = MdCalendarToday;
export const AlarmIcon = MdNotificationsActive;
export const ThemeIcon = MdPalette;
export const UserIcon = MdAccountCircle;
export const FullscreenIcon = MdFullscreen;
export const ZoomIcon = MdZoomIn;
export const ExitIcon = MdExitToApp;
export const OkIcon = MdCheck;
export const OperatorIcon = MdPerson;
export const EngineerIcon = MdBuild;
export const AdminIcon = MdSecurity;

// 命令图标 Record（用于兼容现有代码）
export const CommandIcons: Record<string, JSX.Element> = {
    newJob: <AddIcon />,
    runJob: <PlayIcon />,
    stopJob: <StopIcon />,
    pauseJob: <PauseIcon />,
    refresh: <RefreshIcon />,
    start: <PlayIcon />,
    stop: <StopIcon />,
    pause: <PauseIcon />,
    newRecipe: <NewFileIcon />,
    editRecipe: <EditIcon />,
    deleteRecipe: <DeleteIcon />,
    loadRecipe: <FileIcon />,
    save: <SaveIcon />,
    reset: <ResetIcon />,
    acknowledgeAll: <CheckAllIcon />,
    clearAll: <CloseIcon />,
    export: <ExportIcon />,
    settings: <SettingsIcon />,
    connect: <ConnectIcon />,
    disconnect: <CloseIcon />,
    emergency: <WarningIcon />,
};

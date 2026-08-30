const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const UP = path.join(ROOT, "uploads");

const PORT = process.env.PORT || 3000;

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UP, { recursive: true });

const DB = path.join(DATA, "db.json");

const EMPTY = {
  users: [],
  projects: [],
  doubts: [],
  answers: [],
  opportunities: [],
  applications: [],
  assignments: [],
  connections: [],
  messages: [],
  notifications: [],
  payments: []
};

if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, JSON.stringify(EMPTY, null, 2));
}

/* =========================================================
   DATABASE
========================================================= */

function db() {
  try {
    const data = JSON.parse(fs.readFileSync(DB, "utf8"));

    for (const key of Object.keys(EMPTY)) {
      if (!Array.isArray(data[key])) {
        data[key] = [];
      }
    }

    return data;
  } catch (err) {
    console.error("Database read error:", err);

    fs.writeFileSync(DB, JSON.stringify(EMPTY, null, 2));

    return JSON.parse(JSON.stringify(EMPTY));
  }
}

function save(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

const id = (prefix) =>
  prefix + "_" + crypto.randomBytes(7).toString("hex");

const now = () => new Date().toISOString();

const tok = () =>
  crypto.randomBytes(32).toString("hex");

/* =========================================================
   PASSWORD
========================================================= */

function hash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return (
    salt +
    ":" +
    crypto.scryptSync(password, salt, 64).toString("hex")
  );
}

function verify(password, stored) {
  try {
    const [salt, key] = String(stored).split(":");

    if (!salt || !key) return false;

    const derived = crypto.scryptSync(password, salt, 64).toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(key, "hex"),
      Buffer.from(derived, "hex")
    );
  } catch {
    return false;
  }
}

/* =========================================================
   SEED DEMO DATA
========================================================= */

function seed() {
  const d = db();

  if (d.users.length) return;

  const u = {
    id: id("usr"),
    fullName: "VENZNOVA Demo Student",
    rollNumber: "DEMO/BFTECH/001",
    email: "demo@venz-nova.local",
    graduationYear: "2027",
    programme: "BFTech",
    status: "Student",
    joinAs: "Student",
    skills: "AI, Fashion Technology, Python, Forecasting",
    linkedin: "",
    portfolio: "",
    bio:
      "Demo profile showing how a BFTech student can combine technology and fashion.",
    profilePicture: "",
    passwordHash: hash("Demo1234"),
    sessionToken: "",
    createdAt: now()
  };

  d.users.push(u);

  d.projects.push({
    id: id("prj"),
    userId: u.id,
    title: "AI Fashion Demand Forecasting",
    description:
      "A BFTech concept that uses historical sales and fashion attributes to forecast product demand and support better decisions.",
    category: "AI / Data",
    skills: "Python, Forecasting, Fashion, Data Analytics",
    visibility: "public",
    file: null,
    likes: [],
    createdAt: now()
  });

  d.doubts.push({
    id: id("doubt"),
    userId: u.id,
    title: "How can I combine fashion and AI in a BFTech project?",
    description:
      "Looking for ideas that connect fashion technology with forecasting, prediction or data analytics.",
    category: "Career",
    createdAt: now()
  });

  d.opportunities.push({
    id: id("opp"),
    userId: u.id,
    title: "Fashion Technology Intern — AI & Analytics",
    description:
      "Demo opportunity for students interested in fashion data, forecasting, Python and technology.",
    type: "Internship",
    location: "Remote / India",
    skills: "Python, AI, Fashion, Analytics",
    deadline: "",
    createdAt: now()
  });

  save(d);
}

seed();

/* =========================================================
   PUBLIC USER
========================================================= */

function safe(user) {
  if (!user) return null;

  const x = { ...user };

  delete x.passwordHash;
  delete x.sessionToken;

  return x;
}

/* =========================================================
   RESPONSE
========================================================= */

function send(res, status, data, type = "application/json") {
  const body =
    type === "application/json"
      ? JSON.stringify(data)
      : data;

  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  });

  res.end(body);
}

/* =========================================================
   BODY
========================================================= */

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

/* =========================================================
   COOKIE HELPERS
========================================================= */

function getCookies(req) {
  const header = req.headers.cookie || "";

  const cookies = {};

  header.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  });

  return cookies;
}

function setSessionCookie(res, token) {
  const isProduction =
    process.env.NODE_ENV === "production";

  const cookie =
    "vn_token=" +
    encodeURIComponent(token) +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000" +
    (isProduction ? "; Secure" : "");

  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "vn_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" +
      (process.env.NODE_ENV === "production"
        ? "; Secure"
        : "")
  );
}

/* =========================================================
   AUTHENTICATION
========================================================= */

function auth(req) {
  const d = db();

  /*
    1. First check Authorization header.

    Expected:
    Authorization: Bearer abc123
  */

  const authorization =
    req.headers.authorization || "";

  let token = "";

  if (
    authorization &&
    authorization.toLowerCase().startsWith("bearer ")
  ) {
    token = authorization.slice(7).trim();
  }

  /*
    2. If Authorization is missing, check cookie.

    This is important for Render/browser navigation.
  */

  if (!token) {
    const cookies = getCookies(req);

    token = cookies.vn_token || "";
  }

  if (!token) {
    return null;
  }

  return (
    d.users.find(
      (user) =>
        user.sessionToken &&
        user.sessionToken === token
    ) || null
  );
}

/* =========================================================
   PUBLIC OBJECTS
========================================================= */

function pubProject(project, data) {
  return {
    ...project,
    creator: safe(
      data.users.find(
        (user) => user.id === project.userId
      )
    )
  };
}

function pubDoubt(doubt, data) {
  return {
    ...doubt,

    creator: safe(
      data.users.find(
        (user) => user.id === doubt.userId
      )
    ),

    answers: data.answers
      .filter(
        (answer) =>
          answer.doubtId === doubt.id
      )
      .map((answer) => ({
        ...answer,

        creator: safe(
          data.users.find(
            (user) =>
              user.id === answer.userId
          )
        )
      }))
  };
}

function pubOpp(opportunity, data) {
  return {
    ...opportunity,

    creator: safe(
      data.users.find(
        (user) =>
          user.id === opportunity.userId
      )
    )
  };
}

function pubAssignment(assignment, data) {
  return {
    ...assignment,

    poster: safe(
      data.users.find(
        (user) =>
          user.id === assignment.userId
      )
    ),

    worker: assignment.workerId
      ? safe(
          data.users.find(
            (user) =>
              user.id === assignment.workerId
          )
        )
      : null,

    history: (assignment.history || []).map(
      (history) => ({
        ...history,

        by: safe(
          data.users.find(
            (user) =>
              user.id === history.userId
          )
        )
      })
    )
  };
}

/* =========================================================
   DATABASE SCHEMA
========================================================= */

function ensureSchema() {
  const data = db();

  let changed = false;

  for (const key of [
    "assignments",
    "payments"
  ]) {
    if (!Array.isArray(data[key])) {
      data[key] = [];
      changed = true;
    }
  }

  if (changed) {
    save(data);
  }
}

ensureSchema();

/* =========================================================
   FILE UPLOAD
========================================================= */

function fileFromData(data) {
  if (!data || !data.data) {
    return null;
  }

  const match = String(data.data).match(
    /^data:([^;]+);base64,(.+)$/
  );

  if (!match) {
    throw new Error("Invalid uploaded file");
  }

  const mimeType = match[1];
  const base64 = match[2];

  const extensions = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",

    "application/pdf": ".pdf",
    "application/zip": ".zip",

    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",

    "application/msword":
      ".doc",

    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      ".pptx",

    "application/vnd.ms-powerpoint":
      ".ppt"
  };

  const extension =
    extensions[mimeType] ||
    path.extname(data.name || "").toLowerCase() ||
    ".bin";

  const filename =
    Date.now() +
    "-" +
    crypto.randomBytes(5).toString("hex") +
    extension;

  fs.writeFileSync(
    path.join(UP, filename),
    Buffer.from(base64, "base64")
  );

  return {
    name: data.name || filename,
    url: "/uploads/" + filename,
    size: Buffer.byteLength(
      base64,
      "base64"
    ),
    type: mimeType
  };
}

/* =========================================================
   API
========================================================= */

async function api(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  let body = {};

  if (
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH"
  ) {
    body = await parseBody(req);
  }

  const data = db();
  const user = auth(req);

  /* =======================================================
     HEALTH
  ======================================================= */

  if (
    p === "/api/health" &&
    method === "GET"
  ) {
    return send(res, 200, {
      ok: true,
      name: "VENZNOVA",
      time: now()
    });
  }

  /* =======================================================
     SIGNUP
  ======================================================= */

  if (
    p === "/api/auth/signup" &&
    method === "POST"
  ) {
    const x = body;

    if (
      !x.fullName ||
      !x.rollNumber ||
      !x.email ||
      !x.graduationYear ||
      !x.programme ||
      !x.status ||
      !x.joinAs ||
      !x.password
    ) {
      return send(res, 400, {
        error:
          "Please fill all required fields."
      });
    }

    if (String(x.password).length < 6) {
      return send(res, 400, {
        error:
          "Password must be at least 6 characters."
      });
    }

    const email = String(x.email)
      .trim()
      .toLowerCase();

    const rollNumber = String(
      x.rollNumber
    )
      .trim()
      .toLowerCase();

    if (
      data.users.some(
        (u) => u.email === email
      )
    ) {
      return send(res, 409, {
        error:
          "Email already registered."
      });
    }

    if (
      data.users.some(
        (u) =>
          String(u.rollNumber)
            .toLowerCase() ===
          rollNumber
      )
    ) {
      return send(res, 409, {
        error:
          "Roll number already registered."
      });
    }

    let profilePicture = null;

    try {
      profilePicture =
        fileFromData(
          x.profilePicture
        );
    } catch (err) {
      return send(res, 400, {
        error: err.message
      });
    }

    const token = tok();

    const newUser = {
      id: id("usr"),

      fullName: String(
        x.fullName
      ).trim(),

      rollNumber: String(
        x.rollNumber
      ).trim(),

      email,

      graduationYear: String(
        x.graduationYear
      ),

      programme: x.programme,

      status: x.status,

      joinAs: x.joinAs,

      skills: x.skills || "",

      linkedin: x.linkedin || "",

      portfolio: x.portfolio || "",

      bio: x.bio || "",

      profilePicture:
        profilePicture?.url || "",

      passwordHash:
        hash(x.password),

      sessionToken: token,

      createdAt: now()
    };

    data.users.push(newUser);

    save(data);

    setSessionCookie(res, token);

    return send(res, 200, {
      token,
      user: safe(newUser)
    });
  }

  /* =======================================================
     LOGIN
  ======================================================= */

  if (
    p === "/api/auth/login" &&
    method === "POST"
  ) {
    const email = String(
      body.email || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      body.password || ""
    );

    const foundUser = data.users.find(
      (u) => u.email === email
    );

    if (
      !foundUser ||
      !verify(
        password,
        foundUser.passwordHash
      )
    ) {
      return send(res, 401, {
        error:
          "Invalid email or password."
      });
    }

    const token = tok();

    foundUser.sessionToken = token;

    save(data);

    /*
      Set cookie as an additional authentication
      method. The frontend can still use the token.
    */

    setSessionCookie(res, token);

    return send(res, 200, {
      token,
      user: safe(foundUser)
    });
  }

  /* =======================================================
     LOGOUT
  ======================================================= */

  if (
    p === "/api/auth/logout" &&
    method === "POST"
  ) {
    if (!user) {
      clearSessionCookie(res);

      return send(res, 401, {
        error: "Login required"
      });
    }

    user.sessionToken = "";

    save(data);

    clearSessionCookie(res);

    return send(res, 200, {
      ok: true
    });
  }

  /* =======================================================
     ME
  ======================================================= */

  if (
    p === "/api/me" &&
    method === "GET"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    return send(res, 200, {
      user: safe(user)
    });
  }

  /* =======================================================
     USERS
  ======================================================= */

  if (
    p === "/api/users" &&
    method === "GET"
  ) {
    const q = (
      url.searchParams.get("q") ||
      ""
    ).toLowerCase();

    const programme = (
      url.searchParams.get(
        "programme"
      ) || ""
    ).toLowerCase();

    let users = data.users.map(safe);

    if (q) {
      users = users.filter((x) =>
        [
          x.fullName,
          x.rollNumber,
          x.programme,
          x.skills,
          x.bio
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    if (
      programme &&
      programme !== "all"
    ) {
      users = users.filter(
        (x) =>
          String(x.programme)
            .toLowerCase() ===
          programme
      );
    }

    return send(res, 200, {
      users
    });
  }

  /* =======================================================
     PROJECTS GET
  ======================================================= */

  if (
    p === "/api/projects" &&
    method === "GET"
  ) {
    const q = (
      url.searchParams.get("q") ||
      ""
    ).toLowerCase();

    let projects = data.projects
      .filter(
        (x) =>
          x.visibility !==
          "private"
      )
      .map((x) =>
        pubProject(x, data)
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    if (q) {
      projects = projects.filter(
        (x) =>
          [
            x.title,
            x.description,
            x.category,
            x.skills,
            x.creator?.fullName
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
      );
    }

    return send(res, 200, {
      projects
    });
  }

  /* =======================================================
     PROJECT CREATE
  ======================================================= */

  if (
    p === "/api/projects" &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    if (
      !body.title ||
      !body.description
    ) {
      return send(res, 400, {
        error:
          "Project title and description are required."
      });
    }

    let file = null;

    try {
      file = fileFromData(
        body.projectFile
      );
    } catch (err) {
      return send(res, 400, {
        error: err.message
      });
    }

    const project = {
      id: id("prj"),

      userId: user.id,

      title: String(
        body.title
      ).trim(),

      description: String(
        body.description
      ).trim(),

      category:
        body.category ||
        "Fashion & Textiles",

      skills:
        body.skills || "",

      visibility:
        body.visibility ||
        "public",

      file,

      likes: [],

      createdAt: now()
    };

    data.projects.push(project);

    save(data);

    return send(res, 200, {
      project:
        pubProject(
          project,
          data
        )
    });
  }

  /* =======================================================
     PROJECT LIKE
  ======================================================= */

  let match =
    p.match(
      /^\/api\/projects\/([^/]+)\/like$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const project =
      data.projects.find(
        (x) =>
          x.id === match[1]
      );

    if (!project) {
      return send(res, 404, {
        error:
          "Project not found"
      });
    }

    project.likes =
      project.likes || [];

    const index =
      project.likes.indexOf(
        user.id
      );

    if (index >= 0) {
      project.likes.splice(
        index,
        1
      );
    } else {
      project.likes.push(
        user.id
      );
    }

    save(data);

    return send(res, 200, {
      likes:
        project.likes.length,

      liked:
        index < 0
    });
  }

  /* =======================================================
     DOUBTS GET
  ======================================================= */

  if (
    p === "/api/doubts" &&
    method === "GET"
  ) {
    const q = (
      url.searchParams.get("q") ||
      ""
    ).toLowerCase();

    let doubts = data.doubts
      .map((x) =>
        pubDoubt(x, data)
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    if (q) {
      doubts = doubts.filter(
        (x) =>
          [
            x.title,
            x.description,
            x.category,
            x.creator?.fullName
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
      );
    }

    return send(res, 200, {
      doubts
    });
  }

  /* =======================================================
     DOUBT CREATE
  ======================================================= */

  if (
    p === "/api/doubts" &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    if (
      !body.title ||
      !body.description
    ) {
      return send(res, 400, {
        error:
          "Title and description are required."
      });
    }

    const doubt = {
      id: id("doubt"),

      userId: user.id,

      title: String(
        body.title
      ).trim(),

      description: String(
        body.description
      ).trim(),

      category:
        body.category ||
        "Academic",

      createdAt: now()
    };

    data.doubts.push(doubt);

    save(data);

    return send(res, 200, {
      doubt:
        pubDoubt(
          doubt,
          data
        )
    });
  }

  /* =======================================================
     ANSWER
  ======================================================= */

  match =
    p.match(
      /^\/api\/doubts\/([^/]+)\/answers$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const doubt =
      data.doubts.find(
        (x) =>
          x.id === match[1]
      );

    if (!doubt) {
      return send(res, 404, {
        error:
          "Doubt not found"
      });
    }

    if (!body.text) {
      return send(res, 400, {
        error:
          "Answer cannot be empty."
      });
    }

    const answer = {
      id: id("ans"),

      doubtId:
        doubt.id,

      userId:
        user.id,

      text: String(
        body.text
      ).trim(),

      createdAt: now()
    };

    data.answers.push(answer);

    data.notifications.push({
      id: id("ntf"),

      userId:
        doubt.userId,

      type: "answer",

      text:
        `${user.fullName} answered your doubt: ${doubt.title}`,

      createdAt: now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      answer: {
        ...answer,
        creator:
          safe(user)
      }
    });
  }

  /* =======================================================
     OPPORTUNITIES GET
  ======================================================= */

  if (
    p === "/api/opportunities" &&
    method === "GET"
  ) {
    const q = (
      url.searchParams.get("q") ||
      ""
    ).toLowerCase();

    let opportunities =
      data.opportunities
        .map((x) =>
          pubOpp(x, data)
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );

    if (q) {
      opportunities =
        opportunities.filter(
          (x) =>
            [
              x.title,
              x.description,
              x.type,
              x.location,
              x.skills,
              x.creator?.fullName
            ]
              .join(" ")
              .toLowerCase()
              .includes(q)
        );
    }

    return send(res, 200, {
      opportunities
    });
  }

  /* =======================================================
     OPPORTUNITY CREATE
  ======================================================= */

  if (
    p === "/api/opportunities" &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    if (
      !body.title ||
      !body.description
    ) {
      return send(res, 400, {
        error:
          "Title and description are required."
      });
    }

    const opportunity = {
      id: id("opp"),

      userId: user.id,

      title: String(
        body.title
      ).trim(),

      description: String(
        body.description
      ).trim(),

      type:
        body.type ||
        "Internship",

      location:
        body.location ||
        "Remote",

      skills:
        body.skills || "",

      deadline:
        body.deadline || "",

      createdAt: now()
    };

    data.opportunities.push(
      opportunity
    );

    save(data);

    return send(res, 200, {
      opportunity:
        pubOpp(
          opportunity,
          data
        )
    });
  }

  /* =======================================================
     OPPORTUNITY APPLY
  ======================================================= */

  match =
    p.match(
      /^\/api\/opportunities\/([^/]+)\/apply$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const opportunity =
      data.opportunities.find(
        (x) =>
          x.id === match[1]
      );

    if (!opportunity) {
      return send(res, 404, {
        error:
          "Opportunity not found"
      });
    }

    if (
      data.applications.some(
        (a) =>
          a.opportunityId ===
            opportunity.id &&
          a.userId ===
            user.id
      )
    ) {
      return send(res, 409, {
        error:
          "You already applied."
      });
    }

    const application = {
      id: id("app"),

      opportunityId:
        opportunity.id,

      userId:
        user.id,

      message:
        body.message || "",

      status:
        "Applied",

      createdAt: now()
    };

    data.applications.push(
      application
    );

    data.notifications.push({
      id: id("ntf"),

      userId:
        opportunity.userId,

      type:
        "application",

      text:
        `${user.fullName} applied for ${opportunity.title}`,

      createdAt: now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      application
    });
  }

  /* =======================================================
     ASSIGNMENTS GET
  ======================================================= */

  if (
    p === "/api/assignments" &&
    method === "GET"
  ) {
    const q = (
      url.searchParams.get("q") ||
      ""
    ).toLowerCase();

    let assignments =
      data.assignments
        .map((x) =>
          pubAssignment(x, data)
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        );

    if (q) {
      assignments =
        assignments.filter(
          (x) =>
            [
              x.title,
              x.description,
              x.category,
              x.skills,
              x.poster?.fullName,
              x.worker?.fullName,
              x.status
            ]
              .join(" ")
              .toLowerCase()
              .includes(q)
        );
    }

    return send(res, 200, {
      assignments
    });
  }

  /* =======================================================
     ASSIGNMENT CREATE
  ======================================================= */

  if (
    p === "/api/assignments" &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    if (
      !body.title ||
      !body.description ||
      !body.budget
    ) {
      return send(res, 400, {
        error:
          "Title, description and budget are required."
      });
    }

    const budget =
      Number(body.budget);

    if (
      !Number.isFinite(budget) ||
      budget <= 0
    ) {
      return send(res, 400, {
        error:
          "Budget must be a positive number."
      });
    }

    let assignmentFile = null;

    try {
      assignmentFile =
        fileFromData(
          body.assignmentFile
        );
    } catch (err) {
      return send(res, 400, {
        error: err.message
      });
    }

    const advancePercent =
      Math.min(
        100,
        Math.max(
          10,
          Number(
            body.advancePercent
          ) || 30
        )
      );

    const reworksAllowed =
      Math.min(
        3,
        Math.max(
          1,
          Number(
            body.reworksAllowed
          ) || 3
        )
      );

    const assignment = {
      id: id("asgn"),

      userId:
        user.id,

      title: String(
        body.title
      ).trim(),

      description: String(
        body.description
      ).trim(),

      category:
        body.category ||
        "Fashion / Design",

      skills:
        body.skills || "",

      budget,

      advancePercent,

      deadline:
        body.deadline || "",

      assignmentFile,

      status: "open",

      workerId: null,

      acceptedAt: null,

      advancePaid: false,

      advancePaidAt: null,

      submittedAt: null,

      finalApprovedAt: null,

      finalPaid: false,

      finalPaidAt: null,

      reworksAllowed,

      reworksUsed: 0,

      reworkFeedback: [],

      history: [
        {
          type: "posted",
          userId:
            user.id,
          createdAt:
            now()
        }
      ],

      createdAt:
        now()
    };

    data.assignments.push(
      assignment
    );

    save(data);

    return send(res, 200, {
      assignment:
        pubAssignment(
          assignment,
          data
        )
    });
  }

  /* =======================================================
     ASSIGNMENT ACCEPT
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/accept$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const assignment =
      data.assignments.find(
        (x) =>
          x.id === match[1]
      );

    if (!assignment) {
      return send(res, 404, {
        error:
          "Assignment not found"
      });
    }

    if (
      assignment.userId ===
      user.id
    ) {
      return send(res, 400, {
        error:
          "You cannot accept your own assignment."
      });
    }

    if (
      assignment.status !==
      "open"
    ) {
      return send(res, 409, {
        error:
          "This assignment is no longer open."
      });
    }

    assignment.workerId =
      user.id;

    assignment.status =
      "accepted";

    assignment.acceptedAt =
      now();

    assignment.history.push({
      type: "accepted",
      userId:
        user.id,
      createdAt:
        now()
    });

    data.notifications.push({
      id: id("ntf"),

      userId:
        assignment.userId,

      type:
        "assignment",

      text:
        `${user.fullName} accepted your assignment: ${assignment.title}. Advance payment is now due.`,

      createdAt:
        now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      assignment:
        pubAssignment(
          assignment,
          data
        )
    });
  }

  /* =======================================================
     ADVANCE PAYMENT
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/advance$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const assignment =
      data.assignments.find(
        (x) =>
          x.id === match[1]
      );

    if (!assignment) {
      return send(res, 404, {
        error:
          "Assignment not found"
      });
    }

    if (
      assignment.userId !==
      user.id
    ) {
      return send(res, 403, {
        error:
          "Only the assignment poster can pay the advance."
      });
    }

    if (
      assignment.status !==
        "accepted" ||
      !assignment.workerId
    ) {
      return send(res, 409, {
        error:
          "A worker must accept the assignment first."
      });
    }

    if (
      assignment.advancePaid
    ) {
      return send(res, 409, {
        error:
          "Advance already paid."
      });
    }

    const amount = Math.round(
      assignment.budget *
        assignment.advancePercent /
        100
    );

    assignment.advancePaid =
      true;

    assignment.advancePaidAt =
      now();

    assignment.advanceAmount =
      amount;

    assignment.status =
      "advance_paid";

    assignment.history.push({
      type:
        "advance_paid",

      userId:
        user.id,

      amount,

      createdAt:
        now()
    });

    data.payments.push({
      id: id("pay"),

      assignmentId:
        assignment.id,

      payerId:
        user.id,

      payeeId:
        assignment.workerId,

      type:
        "advance",

      amount,

      status:
        "paid",

      createdAt:
        now()
    });

    data.notifications.push({
      id: id("ntf"),

      userId:
        assignment.workerId,

      type:
        "payment",

      text:
        `Advance of ₹${amount.toLocaleString("en-IN")} paid for ${assignment.title}. You can start the work.`,

      createdAt:
        now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      assignment:
        pubAssignment(
          assignment,
          data
        ),

      amount
    });
  }

  /* =======================================================
     ASSIGNMENT SUBMIT
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/submit$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const assignment =
      data.assignments.find(
        (x) =>
          x.id === match[1]
      );

    if (!assignment) {
      return send(res, 404, {
        error:
          "Assignment not found"
      });
    }

    if (
      assignment.workerId !==
      user.id
    ) {
      return send(res, 403, {
        error:
          "Only the accepted worker can submit."
      });
    }

    if (
      ![
        "advance_paid",
        "rework"
      ].includes(
        assignment.status
      )
    ) {
      return send(res, 409, {
        error:
          "Advance must be paid before submission."
      });
    }

    if (!body.note) {
      return send(res, 400, {
        error:
          "Add a delivery note."
      });
    }

    let file = null;

    try {
      file = fileFromData(
        body.file
      );
    } catch (err) {
      return send(res, 400, {
        error: err.message
      });
    }

    assignment.deliveryNote =
      String(
        body.note
      ).trim();

    assignment.deliveryFile =
      file;

    assignment.submittedAt =
      now();

    assignment.status =
      "submitted";

    assignment.history.push({
      type:
        "submitted",

      userId:
        user.id,

      createdAt:
        now()
    });

    data.notifications.push({
      id: id("ntf"),

      userId:
        assignment.userId,

      type:
        "submission",

      text:
        `${user.fullName} submitted ${assignment.title} for review.`,

      createdAt:
        now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      assignment:
        pubAssignment(
          assignment,
          data
        )
    });
  }

  /* =======================================================
     REWORK
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/rework$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const assignment =
      data.assignments.find(
        (x) =>
          x.id === match[1]
      );

    if (!assignment) {
      return send(res, 404, {
        error:
          "Assignment not found"
      });
    }

    if (
      assignment.userId !==
      user.id
    ) {
      return send(res, 403, {
        error:
          "Only the assignment poster can request rework."
      });
    }

    if (
      assignment.status !==
      "submitted"
    ) {
      return send(res, 409, {
        error:
          "Rework can be requested only after a submission."
      });
    }

    if (
      assignment.reworksUsed >=
      assignment.reworksAllowed
    ) {
      return send(res, 409, {
        error:
          `Maximum ${assignment.reworksAllowed} reworks already used.`
      });
    }

    if (!body.feedback) {
      return send(res, 400, {
        error:
          "Please describe the rework required."
      });
    }

    assignment.reworksUsed++;

    assignment.reworkFeedback.push(
      {
        round:
          assignment.reworksUsed,

        text:
          String(
            body.feedback
          ).trim(),

        createdAt:
          now(),

        userId:
          user.id
      }
    );

    assignment.status =
      "rework";

    assignment.history.push({
      type:
        "rework",

      userId:
        user.id,

      round:
        assignment.reworksUsed,

      createdAt:
        now()
    });

    data.notifications.push({
      id: id("ntf"),

      userId:
        assignment.workerId,

      type:
        "rework",

      text:
        `Rework ${assignment.reworksUsed}/${assignment.reworksAllowed} requested for ${assignment.title}.`,

      createdAt:
        now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      assignment:
        pubAssignment(
          assignment,
          data
        )
    });
  }

  /* =======================================================
     APPROVE
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/approve$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const assignment =
      data.assignments.find(
        (x) =>
          x.id === match[1]
      );

    if (!assignment) {
      return send(res, 404, {
        error:
          "Assignment not found"
      });
    }

    if (
      assignment.userId !==
      user.id
    ) {
      return send(res, 403, {
        error:
          "Only the poster can approve the work."
      });
    }

    if (
      assignment.status !==
      "submitted"
    ) {
      return send(res, 409, {
        error:
          "There is no submission waiting for approval."
      });
    }

    assignment.status =
      "approved_payment_due";

    assignment.finalApprovedAt =
      now();

    assignment.history.push({
      type:
        "approved",

      userId:
        user.id,

      createdAt:
        now()
    });

    data.notifications.push({
      id: id("ntf"),

      userId:
        assignment.workerId,

      type:
        "approval",

      text:
        `Your work for ${assignment.title} was approved. Final payment is due.`,

      createdAt:
        now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      assignment:
        pubAssignment(
          assignment,
          data
        )
    });
  }

  /* =======================================================
     FINAL PAYMENT
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/final-payment$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const assignment =
      data.assignments.find(
        (x) =>
          x.id === match[1]
      );

    if (!assignment) {
      return send(res, 404, {
        error:
          "Assignment not found"
      });
    }

    if (
      assignment.userId !==
      user.id
    ) {
      return send(res, 403, {
        error:
          "Only the assignment poster can pay the final amount."
      });
    }

    if (
      assignment.status !==
      "approved_payment_due"
    ) {
      return send(res, 409, {
        error:
          "Approve the final submission first."
      });
    }

    const amount =
      assignment.budget -
      (
        assignment.advanceAmount ||
        Math.round(
          assignment.budget *
            assignment.advancePercent /
            100
        )
      );

    assignment.finalPaid =
      true;

    assignment.finalPaidAt =
      now();

    assignment.finalAmount =
      amount;

    assignment.status =
      "completed";

    assignment.history.push({
      type:
        "final_paid",

      userId:
        user.id,

      amount,

      createdAt:
        now()
    });

    data.payments.push({
      id: id("pay"),

      assignmentId:
        assignment.id,

      payerId:
        user.id,

      payeeId:
        assignment.workerId,

      type:
        "final",

      amount,

      status:
        "paid",

      createdAt:
        now()
    });

    data.notifications.push({
      id: id("ntf"),

      userId:
        assignment.workerId,

      type:
        "payment",

      text:
        `Final payment of ₹${amount.toLocaleString("en-IN")} paid. Assignment completed: ${assignment.title}`,

      createdAt:
        now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      assignment:
        pubAssignment(
          assignment,
          data
        ),

      amount
    });
  }

  /* =======================================================
     CONNECTION
  ======================================================= */

  match =
    p.match(
      /^\/api\/connections\/([^/]+)$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    if (
      match[1] === user.id
    ) {
      return send(res, 400, {
        error:
          "You cannot connect with yourself."
      });
    }

    const target =
      data.users.find(
        (x) =>
          x.id === match[1]
      );

    if (!target) {
      return send(res, 404, {
        error:
          "User not found."
      });
    }

    let connection =
      data.connections.find(
        (x) =>
          (
            x.from === user.id &&
            x.to === target.id
          ) ||
          (
            x.from === target.id &&
            x.to === user.id
          )
      );

    if (connection) {
      return send(res, 200, {
        connection
      });
    }

    connection = {
      id: id("con"),

      from:
        user.id,

      to:
        target.id,

      status:
        "connected",

      createdAt:
        now()
    };

    data.connections.push(
      connection
    );

    data.notifications.push({
      id: id("ntf"),

      userId:
        target.id,

      type:
        "connection",

      text:
        `${user.fullName} connected with you`,

      createdAt:
        now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      connection
    });
  }

  /* =======================================================
     CONNECTIONS
  ======================================================= */

  if (
    p === "/api/connections" &&
    method === "GET"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const ids =
      data.connections
        .filter(
          (c) =>
            c.from === user.id ||
            c.to === user.id
        )
        .map(
          (c) =>
            c.from === user.id
              ? c.to
              : c.from
        );

    return send(res, 200, {
      connections:
        data.users
          .filter((x) =>
            ids.includes(x.id)
          )
          .map(safe)
    });
  }

  /* =======================================================
     MESSAGES GET
  ======================================================= */

  if (
    p === "/api/messages" &&
    method === "GET"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    const other =
      url.searchParams.get(
        "userId"
      );

    return send(res, 200, {
      messages:
        data.messages
          .filter(
            (x) =>
              (
                x.from ===
                  user.id &&
                x.to ===
                  other
              ) ||
              (
                x.from ===
                  other &&
                x.to ===
                  user.id
              )
          )
          .sort(
            (a, b) =>
              new Date(
                a.createdAt
              ) -
              new Date(
                b.createdAt
              )
          )
    });
  }

  /* =======================================================
     MESSAGE POST
  ======================================================= */

  if (
    p === "/api/messages" &&
    method === "POST"
  ) {
    if (!user) {
      return send(res, 401, {
        error: "Login required"
      });
    }

    if (
      !body.to ||
      !body.text
    ) {
      return send(res, 400, {
        error:
          "Recipient and message required."
      });
    }

    if (
      !data.users.some(
        (x) =>
          x.id === body.to
      )
    ) {
      return send(res, 404, {
        error:
          "User not found."
      });
    }

    const message = {
      id: id("msg"),

      from:
        user.id,

      to:
        body.to,

      text:
        String(
          body.text
        ).trim(),

      createdAt:
        now()
    };

    data.messages.push(
      message
    );

    data.notifications.push({
      id: id("ntf"),

      userId:
        body.to,

      type:
        "message",

      text:
        `New message from ${user.fullName}`,

      createdAt:
        now(),

      read: false
    });

    save(data);

    return send(res, 200, {
      message
    });
  }

  /* =======================================================
     DASHBOARD
  ======================================================= */

  if (
    p === "/api/dashboard" &&
    method === "GET"
  ) {
    if (!user) {
      console.log(
        "DASHBOARD AUTH FAILED",
        {
          hasAuthorization:
            !!req.headers.authorization,

          hasCookie:
            !!req.headers.cookie
        }
      );

      return send(res, 401, {
        error:
          "Login required."
      });
    }

    const mine = (
      array,
      key = "userId"
    ) =>
      array.filter(
        (item) =>
          item[key] === user.id
      );

    return send(res, 200, {
      user: safe(user),

      projects:
        mine(
          data.projects
        ).map((x) =>
          pubProject(
            x,
            data
          )
        ),

      doubts:
        mine(
          data.doubts
        ).map((x) =>
          pubDoubt(
            x,
            data
          )
        ),

      opportunities:
        mine(
          data.opportunities
        ).map((x) =>
          pubOpp(
            x,
            data
          )
        ),

      assignments:
        data.assignments
          .filter(
            (x) =>
              x.userId ===
                user.id ||
              x.workerId ===
                user.id
          )
          .map((x) =>
            pubAssignment(
              x,
              data
            )
          ),

      payments:
        data.payments.filter(
          (x) =>
            x.payerId ===
              user.id ||
            x.payeeId ===
              user.id
        ),

      applications:
        mine(
          data.applications
        ),

      connections:
        data.connections.filter(
          (x) =>
            x.from ===
              user.id ||
            x.to ===
              user.id
        ),

      notifications:
        data.notifications
          .filter(
            (x) =>
              x.userId ===
              user.id
          )
          .sort(
            (a, b) =>
              new Date(
                b.createdAt
              ) -
              new Date(
                a.createdAt
              )
          )
          .slice(0, 30)
    });
  }

  /* =======================================================
     UNKNOWN API
  ======================================================= */

  return send(res, 404, {
    error:
      "API route not found"
  });
}

/* =========================================================
   MIME
========================================================= */

function mime(file) {
  const extension =
    path.extname(file)
      .slice(1)
      .toLowerCase();

  return (
    {
      html:
        "text/html; charset=utf-8",

      css:
        "text/css; charset=utf-8",

      js:
        "text/javascript; charset=utf-8",

      json:
        "application/json",

      png:
        "image/png",

      jpg:
        "image/jpeg",

      jpeg:
        "image/jpeg",

      webp:
        "image/webp",

      gif:
        "image/gif",

      pdf:
        "application/pdf"
    }[extension] ||
    "application/octet-stream"
  );
}

/* =========================================================
   SERVER
========================================================= */

const server =
  http.createServer(
    async (req, res) => {
      try {
        /* -----------------------------------------------
           CORS / PREFLIGHT
        ------------------------------------------------ */

        if (
          req.method ===
          "OPTIONS"
        ) {
          res.writeHead(204, {
            "Access-Control-Allow-Origin":
              "*",

            "Access-Control-Allow-Headers":
              "Content-Type, Authorization",

            "Access-Control-Allow-Methods":
              "GET,POST,PUT,PATCH,DELETE,OPTIONS",

            "Access-Control-Allow-Credentials":
              "true"
          });

          return res.end();
        }

        const url =
          new URL(
            req.url,
            "http://localhost"
          );

        /* -----------------------------------------------
           API
        ------------------------------------------------ */

        if (
          url.pathname.startsWith(
            "/api/"
          )
        ) {
          return await api(
            req,
            res,
            url
          );
        }

        /* -----------------------------------------------
           UPLOADS
        ------------------------------------------------ */

        if (
          url.pathname.startsWith(
            "/uploads/"
          )
        ) {
          const file =
            path.join(
              UP,
              path.basename(
                url.pathname
              )
            );

          if (
            !fs.existsSync(file)
          ) {
            return send(
              res,
              404,
              "Not found",
              "text/plain"
            );
          }

          res.writeHead(200, {
            "Content-Type":
              mime(file),

            "Cache-Control":
              "public, max-age=31536000"
          });

          return fs
            .createReadStream(file)
            .pipe(res);
        }

        /* -----------------------------------------------
           STATIC FRONTEND
        ------------------------------------------------ */

        let file;

        if (
          url.pathname === "/"
        ) {
          file =
            path.join(
              PUBLIC,
              "index.html"
            );
        } else {
          const requested =
            path.normalize(
              url.pathname
            ).replace(
              /^[/\\]+/,
              ""
            );

          file =
            path.join(
              PUBLIC,
              requested
            );
        }

        /*
          Prevent access outside public.
        */

        const publicRoot =
          path.resolve(PUBLIC);

        const resolvedFile =
          path.resolve(file);

        if (
          !resolvedFile.startsWith(
            publicRoot
          ) ||
          !fs.existsSync(
            resolvedFile
          ) ||
          fs.statSync(
            resolvedFile
          ).isDirectory()
        ) {
          file =
            path.join(
              PUBLIC,
              "index.html"
            );
        } else {
          file =
            resolvedFile;
        }

        res.writeHead(200, {
          "Content-Type":
            mime(file),

          "Cache-Control":
            "no-cache"
        });

        return fs
          .createReadStream(file)
          .pipe(res);

      } catch (error) {
        console.error(
          "SERVER ERROR:",
          error
        );

        if (
          !res.headersSent
        ) {
          return send(
            res,
            500,
            {
              error:
                error.message ||
                "Server error"
            }
          );
        }
      }
    }
  );

/* =========================================================
   RENDER PORT
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `VENZNOVA running on port ${PORT}`
    );

    console.log(
      `Public folder: ${PUBLIC}`
    );

    console.log(
      `Database: ${DB}`
    );
  }
);
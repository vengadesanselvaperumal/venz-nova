const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const UPLOADS = path.join(ROOT, "uploads");
const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(UPLOADS, { recursive: true });

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL) {
  console.error("Missing SUPABASE_URL in .env");
  process.exit(1);
}

if (!SUPABASE_ANON_KEY) {
  console.error(
    "Missing SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY in .env"
  );
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY in .env"
  );
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const authClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function now() {
  return new Date().toISOString();
}

function sendJSON(res, status, data) {
  if (res.headersSent) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  });

  res.end(JSON.stringify(data));
}

function sendText(
  res,
  status,
  body,
  contentType = "text/plain; charset=utf-8"
) {
  if (res.headersSent) return;

  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;

      if (raw.length > 40 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON request."));
      }
    });

    req.on("error", reject);
  });
}

function safeProfile(profile) {
  if (!profile) return null;
  return { ...profile };
}

async function currentUser(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.substring(7).trim();

  if (!token) {
    return null;
  }

  const {
    data,
    error
  } = await authClient.auth.getUser(token);

  if (error || !data || !data.user) {
    return null;
  }

  return data.user;
}

function requireUser(user, res) {
  if (!user) {
    sendJSON(res, 401, {
      error: "Login required."
    });

    return false;
  }

  return true;
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function cleanString(value) {
  return String(value || "").trim();
}

function getFileExtension(mime, originalName) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      ".pptx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx",
    "text/plain": ".txt",
    "text/csv": ".csv"
  };

  return (
    map[mime] ||
    path.extname(originalName || "").toLowerCase() ||
    ".bin"
  );
}

function saveBase64File(fileData) {
  if (!fileData || !fileData.data) {
    return null;
  }

  const match = String(fileData.data).match(
    /^data:([^;]+);base64,(.+)$/
  );

  if (!match) {
    throw new Error("Invalid uploaded file.");
  }

  const mime = match[1];
  const base64 = match[2];

  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length) {
    throw new Error("Uploaded file is empty.");
  }

  if (buffer.length > 25 * 1024 * 1024) {
    throw new Error("Maximum file size is 25 MB.");
  }

  const extension = getFileExtension(
    mime,
    fileData.name
  );

  const filename =
    Date.now() +
    "-" +
    crypto.randomBytes(8).toString("hex") +
    extension;

  const fullPath = path.join(
    UPLOADS,
    filename
  );

  fs.writeFileSync(fullPath, buffer);

  return {
    name: fileData.name || filename,
    url: "/uploads/" + filename,
    size: buffer.length,
    type: mime
  };
}

async function getProfile(id) {
  if (!id) return null;

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getProfile:", error.message);
    return null;
  }

  return data || null;
}

async function getProfiles(ids) {
  const uniqueIds = [
    ...new Set(
      (ids || []).filter(Boolean)
    )
  ];

  if (!uniqueIds.length) {
    return new Map();
  }

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select("*")
    .in("id", uniqueIds);

  if (error) {
    console.error("getProfiles:", error.message);
    return new Map();
  }

  return new Map(
    (data || []).map(profile => [
      profile.id,
      profile
    ])
  );
}

function publicProject(project, creator) {
  return {
    ...project,
    creator: safeProfile(creator),
    file: project.file_url
      ? {
          url: project.file_url,
          name: project.file_name
        }
      : null
  };
}

function publicDoubt(
  doubt,
  creator,
  answers = []
) {
  return {
    ...doubt,
    creator: safeProfile(creator),
    answers: answers.map(answer => ({
      ...answer,
      creator: safeProfile(answer.creator)
    }))
  };
}

function publicOpportunity(
  opportunity,
  creator
) {
  return {
    ...opportunity,
    creator: safeProfile(creator)
  };
}

function publicAssignment(
  assignment,
  poster,
  worker,
  reworks = []
) {
  return {
    ...assignment,
    poster: safeProfile(poster),
    worker: safeProfile(worker),

    assignmentFile:
      assignment.assignment_file_url
        ? {
            url: assignment.assignment_file_url,
            name: assignment.assignment_file_name
          }
        : null,

    deliveryFile:
      assignment.delivery_file_url
        ? {
            url: assignment.delivery_file_url,
            name: assignment.delivery_file_name
          }
        : null,

    reworkFeedback: reworks
  };
}

async function notify(
  userId,
  type,
  text
) {
  if (!userId) return;

  const { error } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      type,
      text
    });

  if (error) {
    console.error(
      "Notification error:",
      error.message
    );
  }
}

async function addHistory(
  assignmentId,
  userId,
  type,
  meta = {}
) {
  const { error } = await supabase
    .from("assignment_history")
    .insert({
      assignment_id: assignmentId,
      user_id: userId,
      type,
      meta
    });

  if (error) {
    console.error(
      "History error:",
      error.message
    );
  }
}

async function handleAPI(
  req,
  res,
  url
) {
  const pathname = url.pathname;
  const method = req.method;

  let body = {};

  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(
      method
    )
  ) {
    body = await parseBody(req);
  }

  const user = await currentUser(req);

  /* =========================
     HEALTH
  ========================= */

  if (
    pathname === "/api/health" &&
    method === "GET"
  ) {
    const {
      error
    } = await supabase
      .from("profiles")
      .select("id", {
        count: "exact",
        head: true
      });

    return sendJSON(res, 200, {
      ok: !error,
      name: "VENZNOVA",
      database: error
        ? "ERROR"
        : "Supabase PostgreSQL",
      time: now(),
      error: error
        ? error.message
        : null
    });
  }

  /* =========================
     SIGNUP
  ========================= */

  if (
    pathname === "/api/auth/signup" &&
    method === "POST"
  ) {
    const fullName = cleanString(
      body.fullName
    );

    const rollNumber = cleanString(
      body.rollNumber
    );

    const email = normalizeEmail(
      body.email
    );

    const graduationYear =
      Number(body.graduationYear);

    const programme =
      cleanString(body.programme) ||
      "BFTech";

    const status =
      cleanString(body.status) ||
      "Student";

    const joinAs =
      cleanString(body.joinAs) ||
      "Student";

    const password =
      String(body.password || "");

    if (
      !fullName ||
      !rollNumber ||
      !email ||
      !graduationYear ||
      !programme ||
      !password
    ) {
      return sendJSON(res, 400, {
        error:
          "Please fill all required fields."
      });
    }

    if (password.length < 6) {
      return sendJSON(res, 400, {
        error:
          "Password must be at least 6 characters."
      });
    }

    const {
      data: existingProfiles,
      error: existingError
    } = await supabase
      .from("profiles")
      .select("id,email,roll_number")
      .or(
        `email.eq.${email},roll_number.eq.${rollNumber}`
      )
      .limit(1);

    if (
      existingError &&
      !existingError.message
        .toLowerCase()
        .includes("column")
    ) {
      return sendJSON(res, 400, {
        error: existingError.message
      });
    }

    if (
      existingProfiles &&
      existingProfiles.length
    ) {
      return sendJSON(res, 409, {
        error:
          "Email or roll number already registered."
      });
    }

    const {
      data,
      error
    } = await authClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          fullName,
          rollNumber,
          graduationYear,
          programme,
          status,
          joinAs,
          role:
            joinAs.toUpperCase() === "ALUMNI"
              ? "ALUMNI"
              : joinAs.toUpperCase() ===
                "CLIENT"
              ? "CLIENT"
              : joinAs.toUpperCase() ===
                "SENIOR"
              ? "SENIOR"
              : "JUNIOR"
        }
      }
    });

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    if (!data || !data.user) {
      return sendJSON(res, 400, {
        error:
          "Could not create account."
      });
    }

    let photo = null;

    try {
      if (body.profilePicture) {
        photo = saveBase64File(
          body.profilePicture
        );
      }
    } catch (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const roleMap = {
      student: "JUNIOR",
      junior: "JUNIOR",
      senior: "SENIOR",
      alumni: "ALUMNI",
      client: "CLIENT"
    };

    const role =
      roleMap[
        joinAs.toLowerCase()
      ] || "JUNIOR";

    const profile = {
      id: data.user.id,
      name: fullName,
      email,
      roll_number: rollNumber,
      admission_year:
        body.admissionYear
          ? Number(body.admissionYear)
          : null,
      graduation_year:
        graduationYear,
      role,
      campus:
        cleanString(body.campus) ||
        null,
      programme,
      status,
      join_as: joinAs,
      linkedin:
        cleanString(body.linkedin) ||
        "",
      portfolio:
        cleanString(body.portfolio) ||
        "",
      bio:
        cleanString(body.bio) ||
        "",
      skills:
        cleanString(body.skills) ||
        "",
      photo_url:
        photo?.url || ""
    };

    const {
      data: savedProfile,
      error: profileError
    } = await supabase
      .from("profiles")
      .upsert(profile)
      .select("*")
      .single();

    if (profileError) {
      await supabase.auth.admin.deleteUser(
        data.user.id
      );

      return sendJSON(res, 400, {
        error: profileError.message
      });
    }

    return sendJSON(res, 200, {
      token:
        data.session?.access_token || "",
      refreshToken:
        data.session?.refresh_token || "",
      user: safeProfile(
        savedProfile
      ),
      emailConfirmationRequired:
        !data.session
    });
  }

  /* =========================
     LOGIN
  ========================= */

  if (
    pathname === "/api/auth/login" &&
    method === "POST"
  ) {
    const email = normalizeEmail(
      body.email
    );

    const password =
      String(body.password || "");

    if (!email || !password) {
      return sendJSON(res, 400, {
        error:
          "Email and password are required."
      });
    }

    const {
      data,
      error
    } = await authClient.auth.signInWithPassword(
      {
        email,
        password
      }
    );

    if (
      error ||
      !data?.user ||
      !data?.session
    ) {
      return sendJSON(res, 401, {
        error:
          error?.message ||
          "Invalid email or password."
      });
    }

    let profile =
      await getProfile(
        data.user.id
      );

    if (!profile) {
      await supabase
        .from("profiles")
        .upsert({
          id: data.user.id,
          name:
            data.user.email?.split("@")[0] ||
            "User",
          email:
            data.user.email || "",
          programme: "BFTech",
          status: "Student",
          join_as: "Student",
          role: "JUNIOR"
        });

      profile =
        await getProfile(
          data.user.id
        );
    }

    return sendJSON(res, 200, {
      token:
        data.session.access_token,
      refreshToken:
        data.session.refresh_token,
      user: safeProfile(profile)
    });
  }

  /* =========================
     LOGOUT
  ========================= */

  if (
    pathname === "/api/auth/logout" &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    return sendJSON(res, 200, {
      ok: true
    });
  }

  /* =========================
     CURRENT USER
  ========================= */

  if (
    pathname === "/api/me" &&
    method === "GET"
  ) {
    if (!requireUser(user, res))
      return;

    const profile =
      await getProfile(user.id);

    return sendJSON(res, 200, {
      user: profile
    });
  }

  /* =========================
     USERS / NETWORK
  ========================= */

  if (
    pathname === "/api/users" &&
    method === "GET"
  ) {
    const q = cleanString(
      url.searchParams.get("q")
    ).toLowerCase();

    const programme =
      cleanString(
        url.searchParams.get(
          "programme"
        )
      );

    let query =
      supabase
        .from("profiles")
        .select("*")
        .order("created_at", {
          ascending: false
        })
        .limit(1000);

    if (
      programme &&
      programme.toLowerCase() !== "all"
    ) {
      query = query.eq(
        "programme",
        programme
      );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    let users = data || [];

    if (q) {
      users = users.filter(profile => {
        const searchable = [
          profile.name,
          profile.roll_number,
          profile.programme,
          profile.skills,
          profile.bio,
          profile.role,
          profile.status
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchable.includes(q);
      });
    }

    return sendJSON(res, 200, {
      users
    });
  }

  /* =========================
     PROJECTS - GET
  ========================= */

  if (
    pathname === "/api/projects" &&
    method === "GET"
  ) {
    const q = cleanString(
      url.searchParams.get("q")
    ).toLowerCase();

    const {
      data: projects,
      error
    } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", {
        ascending: false
      })
      .limit(1000);

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    const profileMap =
      await getProfiles(
        (projects || []).map(
          project => project.user_id
        )
      );

    let output =
      (projects || []).map(project =>
        publicProject(
          project,
          profileMap.get(
            project.user_id
          )
        )
      );

    if (q) {
      output = output.filter(project =>
        [
          project.title,
          project.description,
          project.category,
          project.skills,
          project.creator?.name
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    return sendJSON(res, 200, {
      projects: output
    });
  }

  /* =========================
     PROJECTS - CREATE
  ========================= */

  if (
    pathname === "/api/projects" &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    if (
      !body.title ||
      !body.description
    ) {
      return sendJSON(res, 400, {
        error:
          "Project title and description are required."
      });
    }

    let file = null;

    try {
      if (body.projectFile) {
        file = saveBase64File(
          body.projectFile
        );
      }
    } catch (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const project = {
      user_id: user.id,
      title: cleanString(body.title),
      description:
        cleanString(
          body.description
        ),
      category:
        cleanString(
          body.category
        ) ||
        "Fashion & Textiles",
      skills:
        cleanString(
          body.skills
        ),
      visibility:
        body.visibility ===
        "private"
          ? "private"
          : "public",
      file_url:
        file?.url || null,
      file_name:
        file?.name || null
    };

    const {
      data,
      error
    } = await supabase
      .from("projects")
      .insert(project)
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    return sendJSON(res, 201, {
      project: publicProject(
        data,
        await getProfile(
          user.id
        )
      )
    });
  }

  /* =========================
     PROJECT LIKE
  ========================= */

  let match =
    pathname.match(
      /^\/api\/projects\/([^/]+)\/like$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const projectId =
      match[1];

    const {
      data: project,
      error
    } = await supabase
      .from("projects")
      .select("id,likes")
      .eq("id", projectId)
      .maybeSingle();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    if (!project) {
      return sendJSON(res, 404, {
        error:
          "Project not found."
      });
    }

    const likes = Array.isArray(
      project.likes
    )
      ? [...project.likes]
      : [];

    const index =
      likes.indexOf(user.id);

    let liked;

    if (index >= 0) {
      likes.splice(index, 1);
      liked = false;
    } else {
      likes.push(user.id);
      liked = true;
    }

    const {
      error: updateError
    } = await supabase
      .from("projects")
      .update({
        likes
      })
      .eq("id", project.id);

    if (updateError) {
      return sendJSON(res, 400, {
        error:
          updateError.message
      });
    }

    return sendJSON(res, 200, {
      likes: likes.length,
      liked
    });
  }

  /* =========================
     DOUBTS - GET
  ========================= */

  if (
    pathname === "/api/doubts" &&
    method === "GET"
  ) {
    const q = cleanString(
      url.searchParams.get("q")
    ).toLowerCase();

    const {
      data: doubts,
      error
    } = await supabase
      .from("doubts")
      .select("*")
      .order("created_at", {
        ascending: false
      })
      .limit(1000);

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    const profileMap =
      await getProfiles(
        (doubts || []).map(
          doubt => doubt.user_id
        )
      );

    const doubtIds =
      (doubts || []).map(
        doubt => doubt.id
      );

    let answers = [];

    if (doubtIds.length) {
      const {
        data
      } = await supabase
        .from("answers")
        .select("*")
        .in(
          "doubt_id",
          doubtIds
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );

      answers = data || [];
    }

    const answerProfiles =
      await getProfiles(
        answers.map(
          answer =>
            answer.user_id
        )
      );

    let output =
      (doubts || []).map(doubt => {
        const doubtAnswers =
          answers
            .filter(
              answer =>
                answer.doubt_id ===
                doubt.id
            )
            .map(answer => ({
              ...answer,
              creator:
                answerProfiles.get(
                  answer.user_id
                )
            }));

        return publicDoubt(
          doubt,
          profileMap.get(
            doubt.user_id
          ),
          doubtAnswers
        );
      });

    if (q) {
      output = output.filter(
        doubt =>
          [
            doubt.title,
            doubt.description,
            doubt.category,
            doubt.creator?.name
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)
      );
    }

    return sendJSON(res, 200, {
      doubts: output
    });
  }

  /* =========================
     DOUBTS - CREATE
  ========================= */

  if (
    pathname === "/api/doubts" &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    if (
      !body.title ||
      !body.description
    ) {
      return sendJSON(res, 400, {
        error:
          "Title and description are required."
      });
    }

    let file = null;

    try {
      if (body.file) {
        file = saveBase64File(
          body.file
        );
      }
    } catch (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("doubts")
      .insert({
        user_id: user.id,
        title:
          cleanString(body.title),
        description:
          cleanString(
            body.description
          ),
        category:
          cleanString(
            body.category
          ) || "Academic",
        file_url:
          file?.url ||
          body.fileUrl ||
          null
      })
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    return sendJSON(res, 201, {
      doubt: publicDoubt(
        data,
        await getProfile(
          user.id
        ),
        []
      )
    });
  }

  /* =========================
     DOUBT ANSWERS
  ========================= */

  match =
    pathname.match(
      /^\/api\/doubts\/([^/]+)\/answers$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const doubtId =
      match[1];

    const text =
      cleanString(
        body.text ||
        body.body
      );

    if (!text) {
      return sendJSON(res, 400, {
        error:
          "Answer cannot be empty."
      });
    }

    const {
      data: doubt
    } = await supabase
      .from("doubts")
      .select("*")
      .eq("id", doubtId)
      .maybeSingle();

    if (!doubt) {
      return sendJSON(res, 404, {
        error:
          "Doubt not found."
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("answers")
      .insert({
        doubt_id: doubt.id,
        user_id: user.id,
        body: text
      })
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const answerer =
      await getProfile(
        user.id
      );

    await notify(
      doubt.user_id,
      "answer",
      `${answerer?.name || "Someone"} answered your doubt: ${doubt.title}`
    );

    return sendJSON(res, 201, {
      answer: {
        ...data,
        creator: answerer
      }
    });
  }

  /* =========================
     OPPORTUNITIES - GET
  ========================= */

  if (
    pathname === "/api/opportunities" &&
    method === "GET"
  ) {
    const q = cleanString(
      url.searchParams.get("q")
    ).toLowerCase();

    const {
      data,
      error
    } = await supabase
      .from("opportunities")
      .select("*")
      .order("created_at", {
        ascending: false
      })
      .limit(1000);

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    const profiles =
      await getProfiles(
        (data || []).map(
          opportunity =>
            opportunity.user_id
        )
      );

    let output =
      (data || []).map(
        opportunity =>
          publicOpportunity(
            opportunity,
            profiles.get(
              opportunity.user_id
            )
          )
      );

    if (q) {
      output = output.filter(
        opportunity =>
          [
            opportunity.title,
            opportunity.description,
            opportunity.type,
            opportunity.location,
            opportunity.skills,
            opportunity.creator?.name
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)
      );
    }

    return sendJSON(res, 200, {
      opportunities: output
    });
  }

  /* =========================
     OPPORTUNITIES - CREATE
  ========================= */

  if (
    pathname === "/api/opportunities" &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    if (
      !body.title ||
      !body.description
    ) {
      return sendJSON(res, 400, {
        error:
          "Title and description are required."
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("opportunities")
      .insert({
        user_id: user.id,
        title:
          cleanString(body.title),
        description:
          cleanString(
            body.description
          ),
        type:
          cleanString(body.type) ||
          "Internship",
        location:
          cleanString(
            body.location
          ) || "Remote",
        skills:
          cleanString(
            body.skills
          ),
        deadline:
          body.deadline ||
          null
      })
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    return sendJSON(res, 201, {
      opportunity:
        publicOpportunity(
          data,
          await getProfile(
            user.id
          )
        )
    });
  }

  /* =========================
     OPPORTUNITY APPLY
  ========================= */

  match =
    pathname.match(
      /^\/api\/opportunities\/([^/]+)\/apply$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const opportunityId =
      match[1];

    const {
      data: opportunity
    } = await supabase
      .from("opportunities")
      .select("*")
      .eq("id", opportunityId)
      .maybeSingle();

    if (!opportunity) {
      return sendJSON(res, 404, {
        error:
          "Opportunity not found."
      });
    }

    if (
      opportunity.user_id ===
      user.id
    ) {
      return sendJSON(res, 400, {
        error:
          "You cannot apply to your own opportunity."
      });
    }

    const {
      data: existing
    } = await supabase
      .from("applications")
      .select("id")
      .eq(
        "opportunity_id",
        opportunity.id
      )
      .eq(
        "user_id",
        user.id
      )
      .maybeSingle();

    if (existing) {
      return sendJSON(res, 409, {
        error:
          "You already applied."
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("applications")
      .insert({
        opportunity_id:
          opportunity.id,
        user_id: user.id,
        message:
          cleanString(
            body.message
          ),
        status: "Applied"
      })
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const applicant =
      await getProfile(
        user.id
      );

    await notify(
      opportunity.user_id,
      "application",
      `${applicant?.name || "Someone"} applied for ${opportunity.title}`
    );

    return sendJSON(res, 201, {
      application: data
    });
  }

  /* =========================
     ASSIGNMENTS - GET
  ========================= */

  if (
    pathname === "/api/assignments" &&
    method === "GET"
  ) {
    const q = cleanString(
      url.searchParams.get("q")
    ).toLowerCase();

    const status =
      cleanString(
        url.searchParams.get(
          "status"
        )
      );

    let query =
      supabase
        .from("assignments")
        .select("*")
        .order("created_at", {
          ascending: false
        })
        .limit(1000);

    if (status) {
      query = query.eq(
        "status",
        status
      );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    const profileMap =
      await getProfiles(
        (data || []).flatMap(
          assignment => [
            assignment.user_id,
            assignment.worker_id
          ]
        )
      );

    const assignmentIds =
      (data || []).map(
        assignment =>
          assignment.id
      );

    let reworks = [];

    if (assignmentIds.length) {
      const {
        data
      } = await supabase
        .from(
          "assignment_reworks"
        )
        .select("*")
        .in(
          "assignment_id",
          assignmentIds
        )
        .order("round", {
          ascending: true
        });

      reworks = data || [];
    }

    let output =
      (data || []).map(
        assignment =>
          publicAssignment(
            assignment,
            profileMap.get(
              assignment.user_id
            ),
            profileMap.get(
              assignment.worker_id
            ),
            reworks.filter(
              rework =>
                rework.assignment_id ===
                assignment.id
            )
          )
      );

    if (q) {
      output = output.filter(
        assignment =>
          [
            assignment.title,
            assignment.description,
            assignment.category,
            assignment.skills,
            assignment.poster?.name,
            assignment.worker?.name,
            assignment.status
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)
      );
    }

    return sendJSON(res, 200, {
      assignments: output
    });
  }

  /* =========================
     ASSIGNMENT - CREATE
  ========================= */

  if (
    pathname === "/api/assignments" &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    if (
      !body.title ||
      !body.description ||
      body.budget == null
    ) {
      return sendJSON(res, 400, {
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
      return sendJSON(res, 400, {
        error:
          "Budget must be greater than zero."
      });
    }

    const advancePercent = Math.min(
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

    let file = null;

    try {
      if (body.assignmentFile) {
        file = saveBase64File(
          body.assignmentFile
        );
      }
    } catch (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const assignment = {
      user_id: user.id,
      title:
        cleanString(body.title),
      description:
        cleanString(
          body.description
        ),
      category:
        cleanString(
          body.category
        ) || "Fashion / Design",
      skills:
        cleanString(
          body.skills
        ),
      budget,
      advance_percent:
        advancePercent,
      deadline:
        body.deadline ||
        null,
      assignment_file_url:
        file?.url || null,
      assignment_file_name:
        file?.name || null,
      status: "open",
      worker_id: null,
      accepted_at: null,
      advance_paid: false,
      advance_paid_at: null,
      advance_amount: null,
      delivery_note: null,
      delivery_file_url: null,
      delivery_file_name: null,
      submitted_at: null,
      final_approved_at: null,
      final_paid: false,
      final_paid_at: null,
      final_amount: null,
      reworks_allowed:
        reworksAllowed,
      reworks_used: 0
    };

    const {
      data,
      error
    } = await supabase
      .from("assignments")
      .insert(assignment)
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    await addHistory(
      data.id,
      user.id,
      "posted"
    );

    return sendJSON(res, 201, {
      assignment:
        publicAssignment(
          data,
          await getProfile(
            user.id
          ),
          null,
          []
        )
    });
  }

  /* =========================
     ASSIGNMENT - ACCEPT
  ========================= */

  match =
    pathname.match(
      /^\/api\/assignments\/([^/]+)\/accept$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const assignmentId =
      match[1];

    const {
      data: assignment
    } = await supabase
      .from("assignments")
      .select("*")
      .eq(
        "id",
        assignmentId
      )
      .maybeSingle();

    if (!assignment) {
      return sendJSON(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      assignment.user_id ===
      user.id
    ) {
      return sendJSON(res, 400, {
        error:
          "You cannot accept your own assignment."
      });
    }

    if (
      assignment.status !==
      "open"
    ) {
      return sendJSON(res, 409, {
        error:
          "This assignment is no longer open."
      });
    }

    const {
      data: updated,
      error
    } = await supabase
      .from("assignments")
      .update({
        worker_id: user.id,
        status: "accepted",
        accepted_at: now()
      })
      .eq(
        "id",
        assignment.id
      )
      .eq(
        "status",
        "open"
      )
      .select("*")
      .maybeSingle();

    if (
      error ||
      !updated
    ) {
      return sendJSON(res, 409, {
        error:
          "This assignment was already accepted by another user."
      });
    }

    await addHistory(
      assignment.id,
      user.id,
      "accepted"
    );

    const worker =
      await getProfile(
        user.id
      );

    await notify(
      assignment.user_id,
      "assignment",
      `${worker?.name || "Someone"} accepted your assignment: ${assignment.title}. Advance payment is now due.`
    );

    return sendJSON(res, 200, {
      assignment:
        publicAssignment(
          updated,
          await getProfile(
            assignment.user_id
          ),
          worker,
          []
        )
    });
  }

  /* =========================
     ASSIGNMENT - ADVANCE PAYMENT
  ========================= */

  match =
    pathname.match(
      /^\/api\/assignments\/([^/]+)\/advance$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      data: assignment
    } = await supabase
      .from("assignments")
      .select("*")
      .eq(
        "id",
        match[1]
      )
      .maybeSingle();

    if (!assignment) {
      return sendJSON(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      assignment.user_id !==
      user.id
    ) {
      return sendJSON(res, 403, {
        error:
          "Only the assignment poster can pay the advance."
      });
    }

    if (
      assignment.status !==
        "accepted" ||
      !assignment.worker_id
    ) {
      return sendJSON(res, 409, {
        error:
          "A worker must accept the assignment first."
      });
    }

    if (assignment.advance_paid) {
      return sendJSON(res, 409, {
        error:
          "Advance already paid."
      });
    }

    const amount =
      Math.round(
        Number(
          assignment.budget
        ) *
          Number(
            assignment.advance_percent
          ) /
          100
      );

    const {
      data: updated,
      error
    } = await supabase
      .from("assignments")
      .update({
        advance_paid: true,
        advance_paid_at: now(),
        advance_amount: amount,
        status: "advance_paid"
      })
      .eq(
        "id",
        assignment.id
      )
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const {
      error: paymentError
    } = await supabase
      .from("payments")
      .insert({
        assignment_id:
          assignment.id,
        payer_id: user.id,
        payee_id:
          assignment.worker_id,
        type: "advance",
        amount,
        status: "paid",
        provider: "demo"
      });

    if (paymentError) {
      return sendJSON(res, 400, {
        error:
          paymentError.message
      });
    }

    await addHistory(
      assignment.id,
      user.id,
      "advance_paid",
      { amount }
    );

    await notify(
      assignment.worker_id,
      "payment",
      `Advance of ₹${amount.toLocaleString(
        "en-IN"
      )} paid for ${assignment.title}. You can start the work.`
    );

    return sendJSON(res, 200, {
      assignment:
        publicAssignment(
          updated,
          await getProfile(
            assignment.user_id
          ),
          await getProfile(
            assignment.worker_id
          ),
          []
        ),
      amount
    });
  }

  /* =========================
     ASSIGNMENT - SUBMIT
  ========================= */

  match =
    pathname.match(
      /^\/api\/assignments\/([^/]+)\/submit$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      data: assignment
    } = await supabase
      .from("assignments")
      .select("*")
      .eq(
        "id",
        match[1]
      )
      .maybeSingle();

    if (!assignment) {
      return sendJSON(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      assignment.worker_id !==
      user.id
    ) {
      return sendJSON(res, 403, {
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
      return sendJSON(res, 409, {
        error:
          "Advance payment must be completed before submission."
      });
    }

    const note =
      cleanString(
        body.note
      );

    if (!note) {
      return sendJSON(res, 400, {
        error:
          "Add a delivery note."
      });
    }

    let file = null;

    try {
      if (body.file) {
        file = saveBase64File(
          body.file
        );
      }
    } catch (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const {
      data: updated,
      error
    } = await supabase
      .from("assignments")
      .update({
        delivery_note: note,
        delivery_file_url:
          file?.url || null,
        delivery_file_name:
          file?.name || null,
        submitted_at: now(),
        status: "submitted"
      })
      .eq(
        "id",
        assignment.id
      )
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    await addHistory(
      assignment.id,
      user.id,
      "submitted"
    );

    const worker =
      await getProfile(
        user.id
      );

    await notify(
      assignment.user_id,
      "submission",
      `${worker?.name || "Worker"} submitted ${assignment.title} for review.`
    );

    return sendJSON(res, 200, {
      assignment:
        publicAssignment(
          updated,
          await getProfile(
            assignment.user_id
          ),
          worker,
          []
        )
    });
  }

  /* =========================
     ASSIGNMENT - REWORK
  ========================= */

  match =
    pathname.match(
      /^\/api\/assignments\/([^/]+)\/rework$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      data: assignment
    } = await supabase
      .from("assignments")
      .select("*")
      .eq(
        "id",
        match[1]
      )
      .maybeSingle();

    if (!assignment) {
      return sendJSON(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      assignment.user_id !==
      user.id
    ) {
      return sendJSON(res, 403, {
        error:
          "Only the assignment poster can request rework."
      });
    }

    if (
      assignment.status !==
      "submitted"
    ) {
      return sendJSON(res, 409, {
        error:
          "Rework can only be requested after a submission."
      });
    }

    if (
      assignment.reworks_used >=
      assignment.reworks_allowed
    ) {
      return sendJSON(res, 409, {
        error:
          `Maximum ${assignment.reworks_allowed} reworks already used.`
      });
    }

    const feedback =
      cleanString(
        body.feedback
      );

    if (!feedback) {
      return sendJSON(res, 400, {
        error:
          "Please describe the rework required."
      });
    }

    const round =
      Number(
        assignment.reworks_used
      ) + 1;

    const {
      error: reworkError
    } = await supabase
      .from(
        "assignment_reworks"
      )
      .insert({
        assignment_id:
          assignment.id,
        round,
        feedback,
        user_id: user.id
      });

    if (reworkError) {
      return sendJSON(res, 400, {
        error:
          reworkError.message
      });
    }

    const {
      data: updated,
      error
    } = await supabase
      .from("assignments")
      .update({
        reworks_used: round,
        status: "rework"
      })
      .eq(
        "id",
        assignment.id
      )
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    await addHistory(
      assignment.id,
      user.id,
      "rework",
      { round }
    );

    await notify(
      assignment.worker_id,
      "rework",
      `Rework ${round}/${assignment.reworks_allowed} requested for ${assignment.title}.`
    );

    const {
      data: reworks
    } = await supabase
      .from(
        "assignment_reworks"
      )
      .select("*")
      .eq(
        "assignment_id",
        assignment.id
      )
      .order("round", {
        ascending: true
      });

    return sendJSON(res, 200, {
      assignment:
        publicAssignment(
          updated,
          await getProfile(
            assignment.user_id
          ),
          await getProfile(
            assignment.worker_id
          ),
          reworks || []
        )
    });
  }

  /* =========================
     ASSIGNMENT - APPROVE
  ========================= */

  match =
    pathname.match(
      /^\/api\/assignments\/([^/]+)\/approve$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      data: assignment
    } = await supabase
      .from("assignments")
      .select("*")
      .eq(
        "id",
        match[1]
      )
      .maybeSingle();

    if (!assignment) {
      return sendJSON(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      assignment.user_id !==
      user.id
    ) {
      return sendJSON(res, 403, {
        error:
          "Only the poster can approve the work."
      });
    }

    if (
      assignment.status !==
      "submitted"
    ) {
      return sendJSON(res, 409, {
        error:
          "There is no submission waiting for approval."
      });
    }

    const {
      data: updated,
      error
    } = await supabase
      .from("assignments")
      .update({
        status:
          "approved_payment_due",
        final_approved_at: now()
      })
      .eq(
        "id",
        assignment.id
      )
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    await addHistory(
      assignment.id,
      user.id,
      "approved"
    );

    await notify(
      assignment.worker_id,
      "approval",
      `Your work for ${assignment.title} was approved. Final payment is due.`
    );

    return sendJSON(res, 200, {
      assignment:
        publicAssignment(
          updated,
          await getProfile(
            assignment.user_id
          ),
          await getProfile(
            assignment.worker_id
          ),
          []
        )
    });
  }

  /* =========================
     ASSIGNMENT - FINAL PAYMENT
  ========================= */

  match =
    pathname.match(
      /^\/api\/assignments\/([^/]+)\/final-payment$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      data: assignment
    } = await supabase
      .from("assignments")
      .select("*")
      .eq(
        "id",
        match[1]
      )
      .maybeSingle();

    if (!assignment) {
      return sendJSON(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      assignment.user_id !==
      user.id
    ) {
      return sendJSON(res, 403, {
        error:
          "Only the assignment poster can pay the final amount."
      });
    }

    if (
      assignment.status !==
      "approved_payment_due"
    ) {
      return sendJSON(res, 409, {
        error:
          "Approve the final submission first."
      });
    }

    if (assignment.final_paid) {
      return sendJSON(res, 409, {
        error:
          "Final payment has already been paid."
      });
    }

    const advanceAmount =
      Number(
        assignment.advance_amount ||
          (
            Number(
              assignment.budget
            ) *
              Number(
                assignment.advance_percent
              )
          ) /
            100
      );

    const finalAmount =
      Math.max(
        0,
        Number(
          assignment.budget
        ) - advanceAmount
      );

    const {
      data: updated,
      error
    } = await supabase
      .from("assignments")
      .update({
        final_paid: true,
        final_paid_at: now(),
        final_amount: finalAmount,
        status: "completed"
      })
      .eq(
        "id",
        assignment.id
      )
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const {
      error: paymentError
    } = await supabase
      .from("payments")
      .insert({
        assignment_id:
          assignment.id,
        payer_id: user.id,
        payee_id:
          assignment.worker_id,
        type: "final",
        amount: finalAmount,
        status: "paid",
        provider: "demo"
      });

    if (paymentError) {
      return sendJSON(res, 400, {
        error:
          paymentError.message
      });
    }

    await addHistory(
      assignment.id,
      user.id,
      "final_paid",
      {
        amount: finalAmount
      }
    );

    await notify(
      assignment.worker_id,
      "payment",
      `Final payment of ₹${finalAmount.toLocaleString(
        "en-IN"
      )} paid. Assignment completed: ${assignment.title}`
    );

    return sendJSON(res, 200, {
      assignment:
        publicAssignment(
          updated,
          await getProfile(
            assignment.user_id
          ),
          await getProfile(
            assignment.worker_id
          ),
          []
        ),
      amount: finalAmount
    });
  }

  /* =========================
     ASSIGNMENT HISTORY
  ========================= */

  match =
    pathname.match(
      /^\/api\/assignments\/([^/]+)\/history$/
    );

  if (
    match &&
    method === "GET"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      data: assignment
    } = await supabase
      .from("assignments")
      .select("*")
      .eq(
        "id",
        match[1]
      )
      .maybeSingle();

    if (!assignment) {
      return sendJSON(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      assignment.user_id !==
        user.id &&
      assignment.worker_id !==
        user.id
    ) {
      return sendJSON(res, 403, {
        error:
          "You are not allowed to view this history."
      });
    }

    const {
      data,
      error
    } = await supabase
      .from(
        "assignment_history"
      )
      .select("*")
      .eq(
        "assignment_id",
        assignment.id
      )
      .order("created_at", {
        ascending: true
      });

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    return sendJSON(res, 200, {
      history: data || []
    });
  }

  /* =========================
     CONNECTIONS - CREATE
  ========================= */

  match =
    pathname.match(
      /^\/api\/connections\/([^/]+)$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const targetId =
      match[1];

    if (
      targetId === user.id
    ) {
      return sendJSON(res, 400, {
        error:
          "You cannot connect with yourself."
      });
    }

    const target =
      await getProfile(
        targetId
      );

    if (!target) {
      return sendJSON(res, 404, {
        error:
          "User not found."
      });
    }

    const {
      data: existing
    } = await supabase
      .from("connections")
      .select("*")
      .or(
        `and(from_id.eq.${user.id},to_id.eq.${targetId}),and(from_id.eq.${targetId},to_id.eq.${user.id})`
      )
      .limit(1)
      .maybeSingle();

    if (existing) {
      return sendJSON(res, 200, {
        connection: existing
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("connections")
      .insert({
        from_id: user.id,
        to_id: targetId,
        status: "connected"
      })
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const me =
      await getProfile(
        user.id
      );

    await notify(
      targetId,
      "connection",
      `${me?.name || "Someone"} connected with you.`
    );

    return sendJSON(res, 201, {
      connection: data
    });
  }

  /* =========================
     CONNECTIONS - GET
  ========================= */

  if (
    pathname === "/api/connections" &&
    method === "GET"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      data,
      error
    } = await supabase
      .from("connections")
      .select("*")
      .or(
        `from_id.eq.${user.id},to_id.eq.${user.id}`
      )
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    const ids =
      (data || []).map(
        connection =>
          connection.from_id ===
          user.id
            ? connection.to_id
            : connection.from_id
      );

    const profiles =
      await getProfiles(ids);

    return sendJSON(res, 200, {
      connections: ids
        .map(id =>
          profiles.get(id)
        )
        .filter(Boolean)
    });
  }

  /* =========================
     MESSAGES - GET
  ========================= */

  if (
    pathname === "/api/messages" &&
    method === "GET"
  ) {
    if (!requireUser(user, res))
      return;

    const other =
      cleanString(
        url.searchParams.get(
          "userId"
        )
      );

    if (!other) {
      return sendJSON(res, 400, {
        error:
          "userId is required."
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("messages")
      .select("*")
      .or(
        `and(from_id.eq.${user.id},to_id.eq.${other}),and(from_id.eq.${other},to_id.eq.${user.id})`
      )
      .order("created_at", {
        ascending: true
      })
      .limit(500);

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    return sendJSON(res, 200, {
      messages: data || []
    });
  }

  /* =========================
     MESSAGES - SEND
  ========================= */

  if (
    pathname === "/api/messages" &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const to =
      cleanString(body.to);

    const messageText =
      cleanString(
        body.text ||
        body.message
      );

    if (!to || !messageText) {
      return sendJSON(res, 400, {
        error:
          "Recipient and message are required."
      });
    }

    if (to === user.id) {
      return sendJSON(res, 400, {
        error:
          "You cannot message yourself."
      });
    }

    const recipient =
      await getProfile(to);

    if (!recipient) {
      return sendJSON(res, 404, {
        error:
          "Recipient not found."
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("messages")
      .insert({
        from_id: user.id,
        to_id: to,
        text: messageText
      })
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    const sender =
      await getProfile(
        user.id
      );

    await notify(
      to,
      "message",
      `New message from ${sender?.name || "Someone"}`
    );

    return sendJSON(res, 201, {
      message: data
    });
  }

  /* =========================
     DASHBOARD
  ========================= */

  if (
    pathname === "/api/dashboard" &&
    method === "GET"
  ) {
    if (!requireUser(user, res))
      return;

    const [
      projectsResult,
      doubtsResult,
      opportunitiesResult,
      assignmentsResult,
      paymentsResult,
      applicationsResult,
      connectionsResult,
      notificationsResult
    ] = await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq(
          "user_id",
          user.id
        )
        .order("created_at", {
          ascending: false
        }),

      supabase
        .from("doubts")
        .select("*")
        .eq(
          "user_id",
          user.id
        )
        .order("created_at", {
          ascending: false
        }),

      supabase
        .from("opportunities")
        .select("*")
        .eq(
          "user_id",
          user.id
        )
        .order("created_at", {
          ascending: false
        }),

      supabase
        .from("assignments")
        .select("*")
        .or(
          `user_id.eq.${user.id},worker_id.eq.${user.id}`
        )
        .order("created_at", {
          ascending: false
        }),

      supabase
        .from("payments")
        .select("*")
        .or(
          `payer_id.eq.${user.id},payee_id.eq.${user.id}`
        )
        .order("created_at", {
          ascending: false
        }),

      supabase
        .from("applications")
        .select("*")
        .eq(
          "user_id",
          user.id
        )
        .order("created_at", {
          ascending: false
        }),

      supabase
        .from("connections")
        .select("*")
        .or(
          `from_id.eq.${user.id},to_id.eq.${user.id}`
        )
        .order("created_at", {
          ascending: false
        }),

      supabase
        .from("notifications")
        .select("*")
        .eq(
          "user_id",
          user.id
        )
        .order("created_at", {
          ascending: false
        })
        .limit(50)
    ]);

    const projects =
      projectsResult.data || [];

    const doubts =
      doubtsResult.data || [];

    const opportunities =
      opportunitiesResult.data || [];

    const assignments =
      assignmentsResult.data || [];

    const payments =
      paymentsResult.data || [];

    const applications =
      applicationsResult.data || [];

    const connections =
      connectionsResult.data || [];

    const notifications =
      notificationsResult.data || [];

    const profiles =
      await getProfiles(
        [
          ...projects.map(
            x => x.user_id
          ),
          ...doubts.map(
            x => x.user_id
          ),
          ...opportunities.map(
            x => x.user_id
          ),
          ...assignments.flatMap(
            x => [
              x.user_id,
              x.worker_id
            ]
          )
        ]
      );

    const assignmentIds =
      assignments.map(
        x => x.id
      );

    let reworks = [];

    if (assignmentIds.length) {
      const {
        data
      } = await supabase
        .from(
          "assignment_reworks"
        )
        .select("*")
        .in(
          "assignment_id",
          assignmentIds
        )
        .order("round", {
          ascending: true
        });

      reworks = data || [];
    }

    return sendJSON(res, 200, {
      projects:
        projects.map(
          project =>
            publicProject(
              project,
              profiles.get(
                project.user_id
              )
            )
        ),

      doubts:
        doubts.map(
          doubt =>
            publicDoubt(
              doubt,
              profiles.get(
                doubt.user_id
              ),
              []
            )
        ),

      opportunities:
        opportunities.map(
          opportunity =>
            publicOpportunity(
              opportunity,
              profiles.get(
                opportunity.user_id
              )
            )
        ),

      assignments:
        assignments.map(
          assignment =>
            publicAssignment(
              assignment,
              profiles.get(
                assignment.user_id
              ),
              profiles.get(
                assignment.worker_id
              ),
              reworks.filter(
                rework =>
                  rework.assignment_id ===
                  assignment.id
              )
            )
        ),

      payments,
      applications,
      connections,
      notifications
    });
  }

  /* =========================
     NOTIFICATIONS - GET
  ========================= */

  if (
    pathname === "/api/notifications" &&
    method === "GET"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      data,
      error
    } = await supabase
      .from("notifications")
      .select("*")
      .eq(
        "user_id",
        user.id
      )
      .order("created_at", {
        ascending: false
      })
      .limit(100);

    if (error) {
      return sendJSON(res, 500, {
        error: error.message
      });
    }

    return sendJSON(res, 200, {
      notifications: data || []
    });
  }

  /* =========================
     NOTIFICATION READ
  ========================= */

  match =
    pathname.match(
      /^\/api\/notifications\/([^/]+)\/read$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const {
      error
    } = await supabase
      .from("notifications")
      .update({
        read: true
      })
      .eq(
        "id",
        match[1]
      )
      .eq(
        "user_id",
        user.id
      );

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    return sendJSON(res, 200, {
      ok: true
    });
  }

  /* =========================
     REPORT
  ========================= */

  if (
    pathname === "/api/reports" &&
    method === "POST"
  ) {
    if (!requireUser(user, res))
      return;

    const targetType =
      cleanString(
        body.targetType
      );

    const reason =
      cleanString(
        body.reason
      );

    if (
      !targetType ||
      !reason
    ) {
      return sendJSON(res, 400, {
        error:
          "Target type and reason are required."
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("reports")
      .insert({
        reporter_id: user.id,
        target_type: targetType,
        target_id:
          body.targetId ||
          null,
        reason
      })
      .select("*")
      .single();

    if (error) {
      return sendJSON(res, 400, {
        error: error.message
      });
    }

    return sendJSON(res, 201, {
      report: data
    });
  }

  return sendJSON(res, 404, {
    error:
      "API route not found."
  });
}

/* =========================
   MIME TYPES
========================= */

function getMimeType(filePath) {
  const extension =
    path
      .extname(filePath)
      .toLowerCase();

  const types = {
    ".html":
      "text/html; charset=utf-8",
    ".css":
      "text/css; charset=utf-8",
    ".js":
      "text/javascript; charset=utf-8",
    ".json":
      "application/json; charset=utf-8",

    ".png":
      "image/png",
    ".jpg":
      "image/jpeg",
    ".jpeg":
      "image/jpeg",
    ".webp":
      "image/webp",
    ".gif":
      "image/gif",

    ".pdf":
      "application/pdf",
    ".zip":
      "application/zip",

    ".doc":
      "application/msword",

    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

    ".ppt":
      "application/vnd.ms-powerpoint",

    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",

    ".xls":
      "application/vnd.ms-excel",

    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

    ".txt":
      "text/plain; charset=utf-8",

    ".csv":
      "text/csv; charset=utf-8"
  };

  return (
    types[extension] ||
    "application/octet-stream"
  );
}

/* =========================
   HTTP SERVER
========================= */

const server =
  http.createServer(
    async (req, res) => {
      try {
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
              "GET, POST, PUT, PATCH, DELETE, OPTIONS"
          });

          return res.end();
        }

        const url =
          new URL(
            req.url,
            `http://localhost:${PORT}`
          );

        if (
          url.pathname.startsWith(
            "/api/"
          )
        ) {
          return await handleAPI(
            req,
            res,
            url
          );
        }

        if (
          url.pathname.startsWith(
            "/uploads/"
          )
        ) {
          const filename =
            path.basename(
              url.pathname
            );

          const filePath =
            path.join(
              UPLOADS,
              filename
            );

          if (
            !fs.existsSync(
              filePath
            )
          ) {
            return sendText(
              res,
              404,
              "File not found."
            );
          }

          res.writeHead(200, {
            "Content-Type":
              getMimeType(
                filePath
              ),
            "Cache-Control":
              "public, max-age=3600",
            "Access-Control-Allow-Origin":
              "*"
          });

          return fs
            .createReadStream(
              filePath
            )
            .pipe(res);
        }

        let requestedPath =
          url.pathname;

        if (
          requestedPath ===
          "/"
        ) {
          requestedPath =
            "/index.html";
        }

        const relativePath =
          path
            .normalize(
              requestedPath
            )
            .replace(
              /^[/\\]+/,
              ""
            );

        let filePath =
          path.join(
            PUBLIC,
            relativePath
          );

        const publicRoot =
          path.resolve(
            PUBLIC
          );

        const resolvedFile =
          path.resolve(
            filePath
          );

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
          filePath =
            path.join(
              PUBLIC,
              "index.html"
            );
        } else {
          filePath =
            resolvedFile;
        }

        if (
          !fs.existsSync(
            filePath
          )
        ) {
          return sendText(
            res,
            404,
            "public/index.html not found."
          );
        }

        res.writeHead(200, {
          "Content-Type":
            getMimeType(
              filePath
            ),
          "Cache-Control":
            "no-cache"
        });

        fs
          .createReadStream(
            filePath
          )
          .pipe(res);
      } catch (error) {
        console.error(
          "SERVER ERROR:",
          error
        );

        if (
          !res.headersSent
        ) {
          sendJSON(res, 500, {
            error:
              error.message ||
              "Internal server error."
          });
        }
      }
    }
  );

server.listen(
  PORT,
  () => {
    console.log(
      "=========================================="
    );

    console.log(
      "          VENZNOVA IS RUNNING"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Local:     http://localhost:${PORT}`
    );

    console.log(
      "Database:  Supabase PostgreSQL"
    );

    console.log(
      "Auth:      Supabase Auth"
    );

    console.log(
      "Storage:   Local uploads"
    );

    console.log(
      "=========================================="
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "UNHANDLED REJECTION:",
      error
    );
  }
);
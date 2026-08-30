const http = require("http");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const { URL } = require("url");

require("dotenv").config({
  path: require("path").join(__dirname, ".env")
});
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const UPLOADS = path.join(ROOT, "uploads");

const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(UPLOADS, { recursive: true });

/*
========================================================
SUPABASE CONFIGURATION
Supports both old and new Supabase key names
========================================================
*/

function cleanEnv(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .trim()
    .replace(/^['\"]|['\"]$/g, "")
    .trim();
}

const SUPABASE_URL = cleanEnv(
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL
);

// Use the standard Supabase anon key first.
// Also supports the newer publishable-key variable name.
const SUPABASE_ANON_KEY = cleanEnv(
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Backend-only secret key.
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PLATFORM_COMMISSION_PERCENT = Number(
  cleanEnv(process.env.PLATFORM_COMMISSION_PERCENT || "10")
);

if (
  !Number.isFinite(PLATFORM_COMMISSION_PERCENT) ||
  PLATFORM_COMMISSION_PERCENT < 0 ||
  PLATFORM_COMMISSION_PERCENT > 100
) {
  throw new Error(
    "PLATFORM_COMMISSION_PERCENT must be between 0 and 100."
  );
}

/*
========================================================
SAFE ENV CHECK
Does NOT print your actual secret keys
========================================================
*/

console.log("");
console.log("==========================================");
console.log("VENZNOVA SUPABASE ENV CHECK");
console.log("==========================================");
console.log(
  "SUPABASE_URL:",
  SUPABASE_URL ? "LOADED" : "MISSING"
);
console.log(
  "SUPABASE_ANON_KEY:",
  SUPABASE_ANON_KEY ? "LOADED" : "MISSING"
);
console.log(
  "SUPABASE_SERVICE_ROLE_KEY:",
  SUPABASE_SERVICE_ROLE_KEY ? "LOADED" : "MISSING"
);
console.log("==========================================");
console.log("");

if (
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  console.error("SUPABASE CONFIGURATION FAILED.");
  console.error("");
  console.error("Your .env must contain:");
  console.error("SUPABASE_URL=...");
  console.error("SUPABASE_ANON_KEY=...");
  console.error("SUPABASE_SERVICE_ROLE_KEY=...");
  console.error("");
  console.error(
    "OR the newer names:"
  );
  console.error("SUPABASE_PUBLISHABLE_KEY=...");
  console.error("SUPABASE_SECRET_KEY=...");
  console.error("");
  process.exit(1);
}

/*
========================================================
SUPABASE CLIENTS
========================================================
*/

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
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
/* =========================================================
   BASIC HELPERS
========================================================= */

function now() {
  return new Date().toISOString();
}

function json(res, status, data) {
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

function text(
  res,
  status,
  body,
  type = "text/plain; charset=utf-8"
) {
  res.writeHead(status, {
    "Content-Type": type,
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

      if (raw.length > 30 * 1024 * 1024) {
        reject(new Error("Request too large"));
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
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

/* =========================================================
   PROFILE NORMALIZATION
========================================================= */

/*
  IMPORTANT FIX

  Your index.html uses camelCase fields:

  fullName
  rollNumber
  graduationYear
  admissionYear
  joinAs

  Supabase normally stores:

  name
  roll_number
  graduation_year
  admission_year
  join_as

  This function gives the frontend BOTH formats.
*/

function safeProfile(profile, authUser = null) {
  const p = profile || {};
  const metadata = authUser?.user_metadata || {};

  const email =
    p.email ||
    authUser?.email ||
    metadata.email ||
    "";

  const fullName =
    p.fullName ||
    p.full_name ||
    p.name ||
    metadata.fullName ||
    metadata.full_name ||
    metadata.name ||
    email.split("@")[0] ||
    "User";

  const rollNumber =
    p.rollNumber ||
    p.roll_number ||
    metadata.rollNumber ||
    metadata.roll_number ||
    "";

  const graduationYear =
    p.graduationYear ??
    p.graduation_year ??
    metadata.graduationYear ??
    metadata.graduation_year ??
    "";

  const admissionYear =
    p.admissionYear ??
    p.admission_year ??
    metadata.admissionYear ??
    metadata.admission_year ??
    "";

  const programme =
    p.programme ||
    metadata.programme ||
    "BFTech";

  const status =
    p.status ||
    metadata.status ||
    "Student";

  const joinAs =
    p.joinAs ||
    p.join_as ||
    metadata.joinAs ||
    metadata.join_as ||
    "Student";

  const role =
    p.role ||
    metadata.role ||
    String(joinAs).toUpperCase();

  const bio =
    p.bio ||
    metadata.bio ||
    "";

  const skills =
    p.skills ||
    metadata.skills ||
    "";

  const campus =
    p.campus ||
    metadata.campus ||
    "";

  const linkedin =
    p.linkedin ||
    metadata.linkedin ||
    "";

  const portfolio =
    p.portfolio ||
    metadata.portfolio ||
    "";

  const photoUrl =
    p.photoUrl ||
    p.photo_url ||
    metadata.photoUrl ||
    metadata.photo_url ||
    "";

  return {
    ...p,

    id:
      p.id ||
      authUser?.id ||
      metadata.sub ||
      "",

    name: fullName,
    fullName: fullName,
    full_name: fullName,

    email: email,

    rollNumber: rollNumber,
    roll_number: rollNumber,

    admissionYear: admissionYear,
    admission_year: admissionYear,

    graduationYear: graduationYear,
    graduation_year: graduationYear,

    programme: programme,

    status: status,

    joinAs: joinAs,
    join_as: joinAs,

    role: role,

    campus: campus,

    linkedin: linkedin,

    portfolio: portfolio,

    bio: bio,

    skills: skills,

    photoUrl: photoUrl,
    photo_url: photoUrl
  };
}

/* =========================================================
   AUTHENTICATION
========================================================= */

async function currentUser(req) {
  try {
    const header =
      req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return null;
    }

    const token =
      header.slice(7).trim();

    if (!token) {
      return null;
    }

    const {
      data,
      error
    } = await authClient.auth.getUser(token);

    if (error) {
      console.error(
        "Supabase getUser error:",
        error.message
      );

      return null;
    }

    if (!data?.user) {
      return null;
    }

    return data.user;
  } catch (error) {
    console.error(
      "currentUser error:",
      error.message
    );

    return null;
  }
}

function requireUser(user, res) {
  if (!user) {
    json(res, 401, {
      error: "Login required"
    });

    return false;
  }

  return true;
}

/* =========================================================
   PROFILE DATABASE
========================================================= */

async function getProfile(id) {
  try {
    if (!id) {
      return null;
    }

    const {
      data,
      error
    } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error(
        "getProfile error:",
        error.message
      );

      return null;
    }

    return data || null;
  } catch (error) {
    console.error(
      "getProfile exception:",
      error.message
    );

    return null;
  }
}

async function getProfiles(ids) {
  const unique = [
    ...new Set(
      (ids || []).filter(Boolean)
    )
  ];

  if (!unique.length) {
    return new Map();
  }

  try {
    const {
      data,
      error
    } = await supabase
      .from("profiles")
      .select("*")
      .in("id", unique);

    if (error) {
      console.error(
        "getProfiles error:",
        error.message
      );

      return new Map();
    }

    return new Map(
      (data || []).map(x => [
        x.id,
        x
      ])
    );
  } catch {
    return new Map();
  }
}

/* =========================================================
   FILE UPLOAD
========================================================= */

function fileFromData(data) {
  if (!data || !data.data) {
    return null;
  }

  const match =
    String(data.data).match(
      /^data:([^;]+);base64,(.+)$/
    );

  if (!match) {
    throw new Error(
      "Invalid uploaded file"
    );
  }

  const mime = match[1];
  const base64 = match[2];

  const extMap = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",

    "application/pdf": ".pdf",

    "application/zip": ".zip",
    "application/x-zip-compressed":
      ".zip",

    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",

    "application/msword":
      ".doc",

    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      ".pptx",

    "application/vnd.ms-powerpoint":
      ".ppt",

    "text/plain": ".txt"
  };

  const ext =
    extMap[mime] ||
    path.extname(
      data.name || ""
    ).toLowerCase() ||
    ".bin";

  const filename =
    `${Date.now()}-` +
    `${crypto.randomBytes(6).toString("hex")}` +
    ext;

  const filepath =
    path.join(
      UPLOADS,
      filename
    );

  fs.writeFileSync(
    filepath,
    Buffer.from(
      base64,
      "base64"
    )
  );

  return {
    name:
      data.name ||
      filename,

    url:
      `/uploads/${filename}`,

    size:
      Buffer.byteLength(
        base64,
        "base64"
      ),

    type:
      mime
  };
}

/* =========================================================
   PUBLIC OBJECT HELPERS
========================================================= */

function publicProject(
  project,
  creator
) {
  return {
    ...project,

    creator:
      safeProfile(creator),

    file:
      project.file_url
        ? {
            url:
              project.file_url,

            name:
              project.file_name
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

    creator:
      safeProfile(creator),

    answers:
      answers.map(a => ({
        ...a,

        creator:
          safeProfile(
            a.creator
          )
      }))
  };
}

function publicOpportunity(
  opportunity,
  creator
) {
  return {
    ...opportunity,

    creator:
      safeProfile(creator)
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

    poster:
      safeProfile(poster),

    worker:
      safeProfile(worker),

    assignmentFile:
      assignment.assignment_file_url
        ? {
            url:
              assignment.assignment_file_url,

            name:
              assignment.assignment_file_name
          }
        : null,

    deliveryFile:
      assignment.delivery_file_url
        ? {
            url:
              assignment.delivery_file_url,

            name:
              assignment.delivery_file_name
          }
        : null,

    reworkFeedback:
      reworks
  };
}

/* =========================================================
   API
========================================================= */

async function api(req, res, u) {
  const p = u.pathname;
  const method = req.method;

  let body = {};

  if (
    [
      "POST",
      "PUT",
      "PATCH",
      "DELETE"
    ].includes(method)
  ) {
    body =
      await parseBody(req);
  }

  const user =
    await currentUser(req);

  /* =======================================================
     HEALTH
  ======================================================= */

  if (
    p === "/api/health" &&
    method === "GET"
  ) {
    try {
      const {
        error
      } = await supabase
        .from("profiles")
        .select(
          "id",
          {
            count: "exact",
            head: true
          }
        );

      return json(res, 200, {
        ok: !error,

        name:
          "VENZNOVA",

        database:
          error
            ? "error"
            : "Supabase PostgreSQL",

        time:
          now(),

        error:
          error?.message ||
          null
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        error:
          error.message
      });
    }
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
      return json(res, 400, {
        error:
          "Please fill all required fields."
      });
    }

    if (
      String(x.password).length < 6
    ) {
      return json(res, 400, {
        error:
          "Password must be at least 6 characters."
      });
    }

    const email =
      String(x.email)
        .trim()
        .toLowerCase();

    const rollNumber =
      String(x.rollNumber)
        .trim();

    /*
      Check existing profile.
    */

    try {
      const {
        data: existing
      } = await supabase
        .from("profiles")
        .select("id")
        .or(
          `email.eq.${email},roll_number.eq.${rollNumber}`
        )
        .limit(1);

      if (
        existing?.length
      ) {
        return json(res, 409, {
          error:
            "Email or roll number already registered."
        });
      }
    } catch (error) {
      console.error(
        "Existing profile check:",
        error.message
      );
    }

    /*
      Create Supabase Auth user.
    */

    const {
      data,
      error
    } =
      await authClient.auth.signUp({
        email:
          email,

        password:
          String(x.password),

        options: {
          data: {
            fullName:
              String(
                x.fullName
              ).trim(),

            rollNumber:
              rollNumber,

            graduationYear:
              Number(
                x.graduationYear
              ),

            admissionYear:
              x.admissionYear
                ? Number(
                    x.admissionYear
                  )
                : "",

            programme:
              x.programme,

            status:
              x.status,

            joinAs:
              x.joinAs,

            campus:
              x.campus || "",

            linkedin:
              x.linkedin || "",

            portfolio:
              x.portfolio || "",

            bio:
              x.bio || "",

            skills:
              x.skills || ""
          }
        }
      });

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    if (!data?.user) {
      return json(res, 400, {
        error:
          "Could not create account."
      });
    }

    /*
      Optional profile picture.
    */

    let pic = null;

    try {
      pic =
        x.profilePicture
          ? fileFromData(
              x.profilePicture
            )
          : null;
    } catch (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    /*
      Create application profile.
    */

    const profile = {
      id:
        data.user.id,

      name:
        String(
          x.fullName
        ).trim(),

      email:
        email,

      roll_number:
        rollNumber,

      admission_year:
        x.admissionYear
          ? Number(
              x.admissionYear
            )
          : null,

      graduation_year:
        Number(
          x.graduationYear
        ),

      role:
        String(
          x.joinAs ||
          "JUNIOR"
        ).toUpperCase(),

      campus:
        x.campus || null,

      programme:
        x.programme,

      status:
        x.status,

      join_as:
        x.joinAs,

      linkedin:
        x.linkedin || "",

      portfolio:
        x.portfolio || "",

      bio:
        x.bio || "",

      skills:
        x.skills || "",

      photo_url:
        pic?.url || ""
    };

    const {
      data: saved,
      error: profileError
    } =
      await supabase
        .from("profiles")
        .insert(profile)
        .select("*")
        .single();

    /*
      If profile insert fails, don't leave
      authentication broken.
    */

    if (profileError) {
      console.error(
        "Profile insert error:",
        profileError.message
      );

      /*
        Try to clean up Auth account.
      */

      try {
        await supabase.auth.admin.deleteUser(
          data.user.id
        );
      } catch {}

      return json(res, 400, {
        error:
          "Account was created in Auth but the profile could not be saved: " +
          profileError.message
      });
    }

    const frontendUser =
      safeProfile(
        saved,
        data.user
      );

    return json(res, 200, {
      token:
        data.session?.access_token ||
        "",

      refreshToken:
        data.session?.refresh_token ||
        "",

      user:
        frontendUser,

      emailConfirmationRequired:
        !data.session
    });
  }

  /* =======================================================
     LOGIN
  ======================================================= */

  if (
    p === "/api/auth/login" &&
    method === "POST"
  ) {
    try {
      const email =
        String(
          body.email || ""
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          body.password || ""
        );

      if (!email || !password) {
        return json(res, 400, {
          error:
            "Email and password are required."
        });
      }

      /*
        SUPABASE PASSWORD LOGIN
      */

      const {
        data,
        error
      } =
        await authClient.auth.signInWithPassword({
          email,
          password
        });

      if (error) {
        console.error(
          "LOGIN SUPABASE ERROR:",
          error.message
        );

        return json(res, 401, {
          error:
            error.message
        });
      }

      /*
        Make absolutely sure session exists.
      */

      if (
        !data?.user ||
        !data?.session
      ) {
        return json(res, 401, {
          error:
            "Supabase login succeeded but no session was returned."
        });
      }

      const authUser =
        data.user;

      /*
        Get application profile.
      */

      let profile =
        await getProfile(
          authUser.id
        );

      /*
        If profile does not exist,
        build one from Supabase Auth metadata.
      */

      if (!profile) {
        const metadata =
          authUser.user_metadata ||
          {};

        const fallbackProfile = {
          id:
            authUser.id,

          name:
            metadata.fullName ||
            metadata.full_name ||
            metadata.name ||
            authUser.email?.split("@")[0] ||
            "User",

          email:
            authUser.email || email,

          roll_number:
            metadata.rollNumber ||
            metadata.roll_number ||
            "",

          admission_year:
            metadata.admissionYear
              ? Number(
                  metadata.admissionYear
                )
              : null,

          graduation_year:
            metadata.graduationYear
              ? Number(
                  metadata.graduationYear
                )
              : null,

          role:
            String(
              metadata.joinAs ||
              metadata.role ||
              "JUNIOR"
            ).toUpperCase(),

          campus:
            metadata.campus ||
            "",

          programme:
            metadata.programme ||
            "BFTech",

          status:
            metadata.status ||
            "Student",

          join_as:
            metadata.joinAs ||
            metadata.join_as ||
            "Student",

          linkedin:
            metadata.linkedin ||
            "",

          portfolio:
            metadata.portfolio ||
            "",

          bio:
            metadata.bio ||
            "",

          skills:
            metadata.skills ||
            "",

          photo_url:
            metadata.photoUrl ||
            metadata.photo_url ||
            ""
        };

        /*
          Try to save fallback profile.
        */

        try {
          const {
            data: createdProfile,
            error:
              createError
          } =
            await supabase
              .from("profiles")
              .upsert(
                fallbackProfile,
                {
                  onConflict: "id"
                }
              )
              .select("*")
              .single();

          if (!createError &&
              createdProfile) {
            profile =
              createdProfile;
          } else {
            console.error(
              "Fallback profile save:",
              createError?.message
            );

            /*
              VERY IMPORTANT:
              Even if database profile creation
              fails, login continues.
            */

            profile =
              fallbackProfile;
          }
        } catch (error) {
          console.error(
            "Fallback profile exception:",
            error.message
          );

          profile =
            fallbackProfile;
        }
      }

      /*
        Convert profile to exactly the format
        expected by index.html.
      */

      const frontendUser =
        safeProfile(
          profile,
          authUser
        );

      /*
        FINAL LOGIN RESPONSE
      */

      return json(res, 200, {
        token:
          data.session.access_token,

        refreshToken:
          data.session.refresh_token,

        user:
          frontendUser
      });

    } catch (error) {
      console.error(
        "LOGIN SERVER ERROR:",
        error
      );

      return json(res, 500, {
        error:
          "Login server error: " +
          error.message
      });
    }
  }

  /* =======================================================
     LOGOUT
  ======================================================= */

  if (
    p === "/api/auth/logout" &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    return json(res, 200, {
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
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    let profile =
      await getProfile(
        user.id
      );

    /*
      Never return null user.
    */

    if (!profile) {
      profile = {
        id:
          user.id,

        email:
          user.email || "",

        name:
          user.user_metadata?.fullName ||
          user.email?.split("@")[0] ||
          "User",

        programme:
          user.user_metadata?.programme ||
          "BFTech",

        status:
          user.user_metadata?.status ||
          "Student",

        join_as:
          user.user_metadata?.joinAs ||
          "Student",

        role:
          String(
            user.user_metadata?.joinAs ||
            "JUNIOR"
          ).toUpperCase()
      };
    }

    return json(res, 200, {
      user:
        safeProfile(
          profile,
          user
        )
    });
  }

  /* =======================================================
     USERS
  ======================================================= */

  if (
    p === "/api/users" &&
    method === "GET"
  ) {
    const q =
      (
        u.searchParams.get("q") ||
        ""
      ).trim();

    const programme =
      (
        u.searchParams.get(
          "programme"
        ) || ""
      ).trim();

    let query =
      supabase
        .from("profiles")
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(1000);

    if (
      programme &&
      programme.toLowerCase() !==
        "all"
    ) {
      query =
        query.eq(
          "programme",
          programme
        );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      return json(res, 500, {
        error:
          error.message
      });
    }

    let users =
      data || [];

    if (q) {
      const s =
        q.toLowerCase();

      users =
        users.filter(
          x =>
            [
              x.name,
              x.roll_number,
              x.programme,
              x.skills,
              x.bio,
              x.role,
              x.status
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(s)
        );
    }

    return json(res, 200, {
      users:
        users.map(
          x =>
            safeProfile(x)
        )
    });
  }

  /* =======================================================
     PROJECTS GET
  ======================================================= */

  if (
    p === "/api/projects" &&
    method === "GET"
  ) {
    const q =
      (
        u.searchParams.get(
          "q"
        ) || ""
      ).toLowerCase();

    const {
      data: projects,
      error
    } =
      await supabase
        .from("projects")
        .select("*")
        .neq(
          "visibility",
          "private"
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(1000);

    if (error) {
      return json(res, 500, {
        error:
          error.message
      });
    }

    const map =
      await getProfiles(
        (projects || [])
          .map(
            x =>
              x.user_id
          )
      );

    let out =
      (projects || [])
        .map(
          x =>
            publicProject(
              x,
              map.get(
                x.user_id
              )
            )
        );

    if (q) {
      out =
        out.filter(
          x =>
            [
              x.title,
              x.description,
              x.category,
              x.skills,
              x.creator?.name
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)
        );
    }

    return json(res, 200, {
      projects:
        out
    });
  }

  /* =======================================================
     PROJECT CREATE
  ======================================================= */

  if (
    p === "/api/projects" &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    if (
      !body.title ||
      !body.description
    ) {
      return json(res, 400, {
        error:
          "Project title and description are required."
      });
    }

    let file = null;

    try {
      file =
        body.projectFile
          ? fileFromData(
              body.projectFile
            )
          : null;
    } catch (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    const project = {
      user_id:
        user.id,

      title:
        String(
          body.title
        ).trim(),

      description:
        String(
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

      file_url:
        file?.url ||
        null,

      file_name:
        file?.name ||
        null
    };

    const {
      data,
      error
    } =
      await supabase
        .from("projects")
        .insert(project)
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    return json(res, 200, {
      project:
        publicProject(
          data,
          await getProfile(
            user.id
          )
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
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: project
    } =
      await supabase
        .from("projects")
        .select(
          "id,likes"
        )
        .eq(
          "id",
          match[1]
        )
        .maybeSingle();

    if (!project) {
      return json(res, 404, {
        error:
          "Project not found"
      });
    }

    const likes =
      Array.isArray(
        project.likes
      )
        ? [
            ...project.likes
          ]
        : [];

    const i =
      likes.indexOf(
        user.id
      );

    if (i >= 0) {
      likes.splice(
        i,
        1
      );
    } else {
      likes.push(
        user.id
      );
    }

    const {
      error
    } =
      await supabase
        .from("projects")
        .update({
          likes
        })
        .eq(
          "id",
          project.id
        );

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    return json(res, 200, {
      likes:
        likes.length,

      liked:
        i < 0
    });
  }

  /* =======================================================
     DOUBTS GET
  ======================================================= */

  if (
    p === "/api/doubts" &&
    method === "GET"
  ) {
    const q =
      (
        u.searchParams.get(
          "q"
        ) || ""
      ).toLowerCase();

    const {
      data: doubts,
      error
    } =
      await supabase
        .from("doubts")
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(1000);

    if (error) {
      return json(res, 500, {
        error:
          error.message
      });
    }

    const map =
      await getProfiles(
        (doubts || [])
          .map(
            x =>
              x.user_id
          )
      );

    const ids =
      (doubts || [])
        .map(
          x =>
            x.id
        );

    let answers = [];

    if (ids.length) {
      const result =
        await supabase
          .from("answers")
          .select("*")
          .in(
            "doubt_id",
            ids
          )
          .order(
            "created_at",
            {
              ascending: true
            }
          );

      answers =
        result.data ||
        [];
    }

    const amap =
      await getProfiles(
        answers.map(
          x =>
            x.user_id
        )
      );

    let out =
      (doubts || [])
        .map(
          x =>
            publicDoubt(
              x,
              map.get(
                x.user_id
              ),
              answers
                .filter(
                  a =>
                    a.doubt_id ===
                    x.id
                )
                .map(
                  a => ({
                    ...a,
                    creator:
                      amap.get(
                        a.user_id
                      )
                  })
                )
            )
        );

    if (q) {
      out =
        out.filter(
          x =>
            [
              x.title,
              x.description,
              x.category,
              x.creator?.name
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)
        );
    }

    return json(res, 200, {
      doubts:
        out
    });
  }

  /* =======================================================
     DOUBT CREATE
  ======================================================= */

  if (
    p === "/api/doubts" &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    if (
      !body.title ||
      !body.description
    ) {
      return json(res, 400, {
        error:
          "Title and description are required."
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from("doubts")
        .insert({
          user_id:
            user.id,

          title:
            String(
              body.title
            ).trim(),

          description:
            String(
              body.description
            ).trim(),

          category:
            body.category ||
            "Academic",

          file_url:
            body.fileUrl ||
            null
        })
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    return json(res, 200, {
      doubt:
        publicDoubt(
          data,
          await getProfile(
            user.id
          ),
          []
        )
    });
  }

  /* =======================================================
     DOUBT ANSWER
  ======================================================= */

  match =
    p.match(
      /^\/api\/doubts\/([^/]+)\/answers$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    if (!body.text) {
      return json(res, 400, {
        error:
          "Answer cannot be empty."
      });
    }

    const {
      data: doubt
    } =
      await supabase
        .from("doubts")
        .select("*")
        .eq(
          "id",
          match[1]
        )
        .maybeSingle();

    if (!doubt) {
      return json(res, 404, {
        error:
          "Doubt not found."
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from("answers")
        .insert({
          doubt_id:
            doubt.id,

          user_id:
            user.id,

          body:
            String(
              body.text
            ).trim()
        })
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    const currentProfile =
      await getProfile(
        user.id
      );

    await supabase
      .from("notifications")
      .insert({
        user_id:
          doubt.user_id,

        type:
          "answer",

        text:
          `${currentProfile?.name || "Someone"} answered your doubt: ${doubt.title}`
      });

    return json(res, 200, {
      answer: {
        ...data,

        creator:
          safeProfile(
            currentProfile
          )
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
    const q =
      (
        u.searchParams.get(
          "q"
        ) || ""
      ).toLowerCase();

    const {
      data,
      error
    } =
      await supabase
        .from("opportunities")
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(1000);

    if (error) {
      return json(res, 500, {
        error:
          error.message
      });
    }

    const map =
      await getProfiles(
        (data || [])
          .map(
            x =>
              x.user_id
          )
      );

    let out =
      (data || [])
        .map(
          x =>
            publicOpportunity(
              x,
              map.get(
                x.user_id
              )
            )
        );

    if (q) {
      out =
        out.filter(
          x =>
            [
              x.title,
              x.description,
              x.type,
              x.location,
              x.skills,
              x.creator?.name
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)
        );
    }

    return json(res, 200, {
      opportunities:
        out
    });
  }

  /* =======================================================
     OPPORTUNITY CREATE
  ======================================================= */

  if (
    p === "/api/opportunities" &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    if (
      !body.title ||
      !body.description
    ) {
      return json(res, 400, {
        error:
          "Title and description are required."
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from("opportunities")
        .insert({
          user_id:
            user.id,

          title:
            String(
              body.title
            ).trim(),

          description:
            String(
              body.description
            ).trim(),

          type:
            body.type ||
            "Internship",

          location:
            body.location ||
            "Remote",

          skills:
            body.skills ||
            "",

          deadline:
            body.deadline ||
            null
        })
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    return json(res, 200, {
      opportunity:
        publicOpportunity(
          data,
          await getProfile(
            user.id
          )
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
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: opportunity
    } =
      await supabase
        .from("opportunities")
        .select("*")
        .eq(
          "id",
          match[1]
        )
        .maybeSingle();

    if (!opportunity) {
      return json(res, 404, {
        error:
          "Opportunity not found."
      });
    }

    const {
      data: old
    } =
      await supabase
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

    if (old) {
      return json(res, 409, {
        error:
          "You already applied."
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from("applications")
        .insert({
          opportunity_id:
            opportunity.id,

          user_id:
            user.id,

          message:
            body.message ||
            "",

          status:
            "Applied"
        })
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    const currentProfile =
      await getProfile(
        user.id
      );

    await supabase
      .from("notifications")
      .insert({
        user_id:
          opportunity.user_id,

        type:
          "application",

        text:
          `${currentProfile?.name || "Someone"} applied for ${opportunity.title}`
      });

    return json(res, 200, {
      application:
        data
    });
  }

  /* =======================================================
     ASSIGNMENTS GET
  ======================================================= */

  if (
    p === "/api/assignments" &&
    method === "GET"
  ) {
    const q =
      (
        u.searchParams.get(
          "q"
        ) || ""
      ).toLowerCase();

    const {
      data,
      error
    } =
      await supabase
        .from("assignments")
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(1000);

    if (error) {
      return json(res, 500, {
        error:
          error.message
      });
    }

    const map =
      await getProfiles(
        (data || [])
          .flatMap(
            x => [
              x.user_id,
              x.worker_id
            ]
          )
      );

    const ids =
      (data || [])
        .map(
          x =>
            x.id
        );

    const {
      data: reworks
    } =
      ids.length
        ? await supabase
            .from(
              "assignment_reworks"
            )
            .select("*")
            .in(
              "assignment_id",
              ids
            )
            .order(
              "round",
              {
                ascending: true
              }
            )
        : {
            data: []
          };

    let out =
      (data || [])
        .map(
          x =>
            publicAssignment(
              x,
              map.get(
                x.user_id
              ),
              map.get(
                x.worker_id
              ),
              (reworks || [])
                .filter(
                  r =>
                    r.assignment_id ===
                    x.id
                )
            )
        );

    if (q) {
      out =
        out.filter(
          x =>
            [
              x.title,
              x.description,
              x.category,
              x.skills,
              x.poster?.name,
              x.worker?.name,
              x.status
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)
        );
    }

    return json(res, 200, {
      assignments:
        out
    });
  }

  /* =======================================================
     ASSIGNMENT CREATE
  ======================================================= */

  if (
    p === "/api/assignments" &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    if (
      !body.title ||
      !body.description ||
      body.budget == null
    ) {
      return json(res, 400, {
        error:
          "Title, description and budget are required."
      });
    }

    const budget =
      Number(
        body.budget
      );

    if (
      !Number.isFinite(
        budget
      ) ||
      budget <= 0
    ) {
      return json(res, 400, {
        error:
          "Budget must be a positive number."
      });
    }

    let file = null;

    try {
      file =
        body.assignmentFile
          ? fileFromData(
              body.assignmentFile
            )
          : null;
    } catch (error) {
      return json(res, 400, {
        error:
          error.message
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
      user_id:
        user.id,

      title:
        String(
          body.title
        ).trim(),

      description:
        String(
          body.description
        ).trim(),

      category:
        body.category ||
        "Fashion / Design",

      skills:
        body.skills ||
        "",

      budget,

      advance_percent:
        advancePercent,

      deadline:
        body.deadline ||
        null,

      assignment_file_url:
        file?.url ||
        null,

      assignment_file_name:
        file?.name ||
        null,

      status:
        "open",

      worker_id:
        null,

      accepted_at:
        null,

      advance_paid:
        false,

      advance_paid_at:
        null,

      advance_amount:
        null,

      submitted_at:
        null,

      final_approved_at:
        null,

      final_paid:
        false,

      final_paid_at:
        null,

      final_amount:
        null,

      reworks_allowed:
        reworksAllowed,

      reworks_used:
        0
    };

    const {
      data,
      error
    } =
      await supabase
        .from("assignments")
        .insert(
          assignment
        )
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    await supabase
      .from(
        "assignment_history"
      )
      .insert({
        assignment_id:
          data.id,

        user_id:
          user.id,

        type:
          "posted",

        meta:
          {}
      });

    return json(res, 200, {
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
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: a
    } =
      await supabase
        .from("assignments")
        .select("*")
        .eq(
          "id",
          match[1]
        )
        .maybeSingle();

    if (!a) {
      return json(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      a.user_id ===
      user.id
    ) {
      return json(res, 400, {
        error:
          "You cannot accept your own assignment."
      });
    }

    if (
      a.status !==
      "open"
    ) {
      return json(res, 409, {
        error:
          "This assignment is no longer open."
      });
    }

    const {
      data: updated,
      error
    } =
      await supabase
        .from("assignments")
        .update({
          worker_id:
            user.id,

          status:
            "accepted",

          accepted_at:
            now()
        })
        .eq(
          "id",
          a.id
        )
        .eq(
          "status",
          "open"
        )
        .select("*")
        .single();

    if (error) {
      return json(res, 409, {
        error:
          "This assignment was already accepted by another user."
      });
    }

    await supabase
      .from(
        "assignment_history"
      )
      .insert({
        assignment_id:
          a.id,

        user_id:
          user.id,

        type:
          "accepted",

        meta:
          {}
      });

    const worker =
      await getProfile(
        user.id
      );

    await supabase
      .from(
        "notifications"
      )
      .insert({
        user_id:
          a.user_id,

        type:
          "assignment",

        text:
          `${worker?.name || "Someone"} accepted your assignment: ${a.title}. Advance payment is now due.`
      });

    return json(res, 200, {
      assignment:
        publicAssignment(
          updated,

          await getProfile(
            a.user_id
          ),

          await getProfile(
            user.id
          ),

          []
        )
    });
  }

  /* =======================================================
     ASSIGNMENT ADVANCE
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/advance$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: a,
      error: assignmentError
    } =
      await supabase
        .from("assignments")
        .select("*")
        .eq("id", match[1])
        .maybeSingle();

    if (assignmentError) {
      return json(res, 500, {
        error: assignmentError.message
      });
    }

    if (!a) {
      return json(res, 404, {
        error: "Assignment not found."
      });
    }

    if (a.user_id !== user.id) {
      return json(res, 403, {
        error: "Only the assignment poster can pay the advance."
      });
    }

    if (
      a.status !== "accepted" ||
      !a.worker_id
    ) {
      return json(res, 409, {
        error: "A worker must accept the assignment first."
      });
    }

    if (a.advance_paid) {
      return json(res, 409, {
        error: "Advance already paid."
      });
    }

    const grossAmount =
      Math.round(
        Number(a.budget) *
        Number(a.advance_percent) /
        100 *
        100
      ) / 100;

    const commissionAmount =
      Math.round(
        grossAmount *
        PLATFORM_COMMISSION_PERCENT /
        100 *
        100
      ) / 100;

    const workerAmount =
      Math.round(
        (grossAmount - commissionAmount) *
        100
      ) / 100;

    const {
      data: updated,
      error
    } =
      await supabase
        .from("assignments")
        .update({
          advance_paid: true,
          advance_paid_at: now(),
          advance_amount: grossAmount,
          status: "advance_paid"
        })
        .eq("id", a.id)
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error: error.message
      });
    }

    const {
      error: paymentError
    } =
      await supabase
        .from("payments")
        .insert({
          assignment_id: a.id,
          payer_id: user.id,
          payee_id: a.worker_id,
          type: "advance",
          amount: workerAmount,
          status: "paid"
        });

    if (paymentError) {
      return json(res, 400, {
        error: paymentError.message
      });
    }

    await supabase
      .from("assignment_history")
      .insert({
        assignment_id: a.id,
        user_id: user.id,
        type: "advance_paid",
        meta: {
          grossAmount,
          commissionPercent: PLATFORM_COMMISSION_PERCENT,
          commissionAmount,
          workerAmount
        }
      });

    await supabase
      .from("notifications")
      .insert({
        user_id: a.worker_id,
        type: "payment",
        text: `Advance of ₹${workerAmount.toLocaleString("en-IN")} paid to you for ${a.title}.`
      });

    return json(res, 200, {
      assignment: publicAssignment(
        updated,
        await getProfile(a.user_id),
        await getProfile(a.worker_id),
        []
      ),
      amount: grossAmount,
      payment: {
        grossAmount,
        commissionPercent: PLATFORM_COMMISSION_PERCENT,
        commissionAmount,
        workerAmount
      }
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
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: a
    } =
      await supabase
        .from("assignments")
        .select("*")
        .eq(
          "id",
          match[1]
        )
        .maybeSingle();

    if (!a) {
      return json(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      a.worker_id !==
      user.id
    ) {
      return json(res, 403, {
        error:
          "Only the accepted worker can submit."
      });
    }

    if (
      ![
        "advance_paid",
        "rework"
      ].includes(
        a.status
      )
    ) {
      return json(res, 409, {
        error:
          "Advance must be paid before submission."
      });
    }

    if (!body.note) {
      return json(res, 400, {
        error:
          "Add a delivery note."
      });
    }

    let file = null;

    try {
      file =
        body.file
          ? fileFromData(
              body.file
            )
          : null;
    } catch (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    const {
      data: updated,
      error
    } =
      await supabase
        .from("assignments")
        .update({
          delivery_note:
            String(
              body.note
            ).trim(),

          delivery_file_url:
            file?.url ||
            null,

          delivery_file_name:
            file?.name ||
            null,

          submitted_at:
            now(),

          status:
            "submitted"
        })
        .eq(
          "id",
          a.id
        )
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    await supabase
      .from(
        "assignment_history"
      )
      .insert({
        assignment_id:
          a.id,

        user_id:
          user.id,

        type:
          "submitted",

        meta:
          {}
      });

    const worker =
      await getProfile(
        user.id
      );

    await supabase
      .from(
        "notifications"
      )
      .insert({
        user_id:
          a.user_id,

        type:
          "submission",

        text:
          `${worker?.name || "Worker"} submitted ${a.title} for review.`
      });

    return json(res, 200, {
      assignment:
        publicAssignment(
          updated,

          await getProfile(
            a.user_id
          ),

          await getProfile(
            user.id
          ),

          []
        )
    });
  }

  /* =======================================================
     ASSIGNMENT REWORK
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/rework$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: a
    } =
      await supabase
        .from("assignments")
        .select("*")
        .eq(
          "id",
          match[1]
        )
        .maybeSingle();

    if (!a) {
      return json(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      a.user_id !==
      user.id
    ) {
      return json(res, 403, {
        error:
          "Only the assignment poster can request rework."
      });
    }

    if (
      a.status !==
      "submitted"
    ) {
      return json(res, 409, {
        error:
          "Rework can be requested only after a submission."
      });
    }

    if (
      a.reworks_used >=
      a.reworks_allowed
    ) {
      return json(res, 409, {
        error:
          `Maximum ${a.reworks_allowed} reworks already used.`
      });
    }

    if (!body.feedback) {
      return json(res, 400, {
        error:
          "Please describe the rework required."
      });
    }

    const round =
      a.reworks_used + 1;

    const {
      error: reworkError
    } =
      await supabase
        .from(
          "assignment_reworks"
        )
        .insert({
          assignment_id:
            a.id,

          round,

          feedback:
            String(
              body.feedback
            ).trim(),

          user_id:
            user.id
        });

    if (reworkError) {
      return json(res, 400, {
        error:
          reworkError.message
      });
    }

    const {
      data: updated,
      error
    } =
      await supabase
        .from("assignments")
        .update({
          reworks_used:
            round,

          status:
            "rework"
        })
        .eq(
          "id",
          a.id
        )
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    await supabase
      .from(
        "assignment_history"
      )
      .insert({
        assignment_id:
          a.id,

        user_id:
          user.id,

        type:
          "rework",

        meta: {
          round
        }
      });

    await supabase
      .from(
        "notifications"
      )
      .insert({
        user_id:
          a.worker_id,

        type:
          "rework",

        text:
          `Rework ${round}/${a.reworks_allowed} requested for ${a.title}.`
      });

    const {
      data: rw
    } =
      await supabase
        .from(
          "assignment_reworks"
        )
        .select("*")
        .eq(
          "assignment_id",
          a.id
        )
        .order(
          "round",
          {
            ascending: true
          }
        );

    return json(res, 200, {
      assignment:
        publicAssignment(
          updated,

          await getProfile(
            a.user_id
          ),

          await getProfile(
            a.worker_id
          ),

          rw || []
        )
    });
  }

  /* =======================================================
     ASSIGNMENT APPROVE
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/approve$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: a
    } =
      await supabase
        .from("assignments")
        .select("*")
        .eq(
          "id",
          match[1]
        )
        .maybeSingle();

    if (!a) {
      return json(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      a.user_id !==
      user.id
    ) {
      return json(res, 403, {
        error:
          "Only the poster can approve the work."
      });
    }

    if (
      a.status !==
      "submitted"
    ) {
      return json(res, 409, {
        error:
          "There is no submission waiting for approval."
      });
    }

    const {
      data: updated,
      error
    } =
      await supabase
        .from("assignments")
        .update({
          status:
            "approved_payment_due",

          final_approved_at:
            now()
        })
        .eq(
          "id",
          a.id
        )
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    await supabase
      .from(
        "assignment_history"
      )
      .insert({
        assignment_id:
          a.id,

        user_id:
          user.id,

        type:
          "approved",

        meta:
          {}
      });

    await supabase
      .from(
        "notifications"
      )
      .insert({
        user_id:
          a.worker_id,

        type:
          "approval",

        text:
          `Your work for ${a.title} was approved. Final payment is due.`
      });

    return json(res, 200, {
      assignment:
        publicAssignment(
          updated,

          await getProfile(
            a.user_id
          ),

          await getProfile(
            a.worker_id
          ),

          []
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
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: a,
      error: assignmentError
    } =
      await supabase
        .from("assignments")
        .select("*")
        .eq("id", match[1])
        .maybeSingle();

    if (assignmentError) {
      return json(res, 500, {
        error: assignmentError.message
      });
    }

    if (!a) {
      return json(res, 404, {
        error: "Assignment not found."
      });
    }

    if (a.user_id !== user.id) {
      return json(res, 403, {
        error: "Only the assignment poster can pay the final amount."
      });
    }

    if (a.status !== "approved_payment_due") {
      return json(res, 409, {
        error: "Approve the final submission first."
      });
    }

    if (a.final_paid) {
      return json(res, 409, {
        error: "Final payment already paid."
      });
    }

    const totalBudget =
      Math.round(Number(a.budget) * 100) / 100;

    const advanceAmount =
      Math.round(
        Number(
          a.advance_amount ||
          (Number(a.budget) * Number(a.advance_percent) / 100)
        ) * 100
      ) / 100;

    const grossFinalAmount =
      Math.max(
        0,
        Math.round(
          (totalBudget - advanceAmount) * 100
        ) / 100
      );

    const commissionAmount =
      Math.round(
        grossFinalAmount *
        PLATFORM_COMMISSION_PERCENT /
        100 *
        100
      ) / 100;

    const workerAmount =
      Math.round(
        (grossFinalAmount - commissionAmount) *
        100
      ) / 100;

    const {
      data: updated,
      error
    } =
      await supabase
        .from("assignments")
        .update({
          final_paid: true,
          final_paid_at: now(),
          final_amount: grossFinalAmount,
          status: "completed"
        })
        .eq("id", a.id)
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error: error.message
      });
    }

    const {
      error: paymentError
    } =
      await supabase
        .from("payments")
        .insert({
          assignment_id: a.id,
          payer_id: user.id,
          payee_id: a.worker_id,
          type: "final",
          amount: workerAmount,
          status: "paid"
        });

    if (paymentError) {
      return json(res, 400, {
        error: paymentError.message
      });
    }

    await supabase
      .from("assignment_history")
      .insert({
        assignment_id: a.id,
        user_id: user.id,
        type: "final_paid",
        meta: {
          grossAmount: grossFinalAmount,
          commissionPercent: PLATFORM_COMMISSION_PERCENT,
          commissionAmount,
          workerAmount
        }
      });

    await supabase
      .from("notifications")
      .insert({
        user_id: a.worker_id,
        type: "payment",
        text: `Final payment of ₹${workerAmount.toLocaleString("en-IN")} paid to you. Assignment completed: ${a.title}`
      });

    return json(res, 200, {
      assignment: publicAssignment(
        updated,
        await getProfile(a.user_id),
        await getProfile(a.worker_id),
        []
      ),
      amount: grossFinalAmount,
      payment: {
        grossAmount: grossFinalAmount,
        commissionPercent: PLATFORM_COMMISSION_PERCENT,
        commissionAmount,
        workerAmount
      }
    });
  }

  /* =======================================================
     ASSIGNMENT HISTORY
  ======================================================= */

  match =
    p.match(
      /^\/api\/assignments\/([^/]+)\/history$/
    );

  if (
    match &&
    method === "GET"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data: a
    } =
      await supabase
        .from("assignments")
        .select("*")
        .eq(
          "id",
          match[1]
        )
        .maybeSingle();

    if (!a) {
      return json(res, 404, {
        error:
          "Assignment not found."
      });
    }

    if (
      a.user_id !==
        user.id &&
      a.worker_id !==
        user.id
    ) {
      return json(res, 403, {
        error:
          "Not allowed."
      });
    }

    const {
      data
    } =
      await supabase
        .from(
          "assignment_history"
        )
        .select("*")
        .eq(
          "assignment_id",
          a.id
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );

    return json(res, 200, {
      history:
        data || []
    });
  }

  /* =======================================================
     CONNECTION CREATE
  ======================================================= */

  match =
    p.match(
      /^\/api\/connections\/([^/]+)$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    if (
      match[1] ===
      user.id
    ) {
      return json(res, 400, {
        error:
          "You cannot connect with yourself."
      });
    }

    const target =
      await getProfile(
        match[1]
      );

    if (!target) {
      return json(res, 404, {
        error:
          "User not found."
      });
    }

    const {
      data: old
    } =
      await supabase
        .from(
          "connections"
        )
        .select("*")
        .or(
          `and(from_id.eq.${user.id},to_id.eq.${target.id}),and(from_id.eq.${target.id},to_id.eq.${user.id})`
        )
        .maybeSingle();

    if (old) {
      return json(res, 200, {
        connection:
          old
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from(
          "connections"
        )
        .insert({
          from_id:
            user.id,

          to_id:
            target.id,

          status:
            "connected"
        })
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    const currentProfile =
      await getProfile(
        user.id
      );

    await supabase
      .from(
        "notifications"
      )
      .insert({
        user_id:
          target.id,

        type:
          "connection",

        text:
          `${currentProfile?.name || "Someone"} connected with you`
      });

    return json(res, 200, {
      connection:
        data
    });
  }

  /* =======================================================
     CONNECTIONS GET
  ======================================================= */

  if (
    p === "/api/connections" &&
    method === "GET"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data,
      error
    } =
      await supabase
        .from(
          "connections"
        )
        .select("*")
        .or(
          `from_id.eq.${user.id},to_id.eq.${user.id}`
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        );

    if (error) {
      return json(res, 500, {
        error:
          error.message
      });
    }

    const ids =
      (data || [])
        .map(
          c =>
            c.from_id ===
            user.id
              ? c.to_id
              : c.from_id
        );

    const map =
      await getProfiles(
        ids
      );

    return json(res, 200, {
      connections:
        ids
          .map(
            id =>
              safeProfile(
                map.get(id)
              )
          )
          .filter(
            Boolean
          )
    });
  }

  /* =======================================================
     MESSAGES GET
  ======================================================= */

  if (
    p === "/api/messages" &&
    method === "GET"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const other =
      u.searchParams.get(
        "userId"
      );

    if (!other) {
      return json(res, 400, {
        error:
          "userId is required."
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from(
          "messages"
        )
        .select("*")
        .or(
          `and(from_id.eq.${user.id},to_id.eq.${other}),and(from_id.eq.${other},to_id.eq.${user.id})`
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        )
        .limit(500);

    if (error) {
      return json(res, 500, {
        error:
          error.message
      });
    }

    return json(res, 200, {
      messages:
        data || []
    });
  }

  /* =======================================================
     MESSAGE CREATE
  ======================================================= */

  if (
    p === "/api/messages" &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    if (
      !body.to ||
      !body.text
    ) {
      return json(res, 400, {
        error:
          "Recipient and message required."
      });
    }

    if (
      !(
        await getProfile(
          body.to
        )
      )
    ) {
      return json(res, 404, {
        error:
          "User not found."
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from(
          "messages"
        )
        .insert({
          from_id:
            user.id,

          to_id:
            body.to,

          text:
            String(
              body.text
            ).trim()
        })
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    const currentProfile =
      await getProfile(
        user.id
      );

    await supabase
      .from(
        "notifications"
      )
      .insert({
        user_id:
          body.to,

        type:
          "message",

        text:
          `New message from ${currentProfile?.name || "Someone"}`
      });

    return json(res, 200, {
      message:
        data
    });
  }

  /* =======================================================
     DASHBOARD
  ======================================================= */

  if (
    p === "/api/dashboard" &&
    method === "GET"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const [
      projectsResult,
      doubtsResult,
      opportunitiesResult,
      assignmentsResult,
      paymentsResult,
      applicationsResult,
      connectionsResult,
      notificationsResult
    ] =
      await Promise.all([
        supabase
          .from("projects")
          .select("*")
          .eq(
            "user_id",
            user.id
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from("doubts")
          .select("*")
          .eq(
            "user_id",
            user.id
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from(
            "opportunities"
          )
          .select("*")
          .eq(
            "user_id",
            user.id
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from(
            "assignments"
          )
          .select("*")
          .or(
            `user_id.eq.${user.id},worker_id.eq.${user.id}`
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from(
            "payments"
          )
          .select("*")
          .or(
            `payer_id.eq.${user.id},payee_id.eq.${user.id}`
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from(
            "applications"
          )
          .select("*")
          .eq(
            "user_id",
            user.id
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from(
            "connections"
          )
          .select("*")
          .or(
            `from_id.eq.${user.id},to_id.eq.${user.id}`
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from(
            "notifications"
          )
          .select("*")
          .eq(
            "user_id",
            user.id
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(30)
      ]);

    const projects =
      projectsResult.data ||
      [];

    const doubts =
      doubtsResult.data ||
      [];

    const opportunities =
      opportunitiesResult.data ||
      [];

    const assignments =
      assignmentsResult.data ||
      [];

    const payments =
      paymentsResult.data ||
      [];

    const applications =
      applicationsResult.data ||
      [];

    const connections =
      connectionsResult.data ||
      [];

    const notifications =
      notificationsResult.data ||
      [];

    const pmap =
      await getProfiles([
        ...projects.map(
          x =>
            x.user_id
        ),

        ...doubts.map(
          x =>
            x.user_id
        ),

        ...opportunities.map(
          x =>
            x.user_id
        ),

        ...assignments.flatMap(
          x => [
            x.user_id,
            x.worker_id
          ]
        )
      ]);

    const aids =
      assignments.map(
        x =>
          x.id
      );

    const {
      data: reworks
    } =
      aids.length
        ? await supabase
            .from(
              "assignment_reworks"
            )
            .select("*")
            .in(
              "assignment_id",
              aids
            )
        : {
            data: []
          };

    return json(res, 200, {
      projects:
        projects.map(
          x =>
            publicProject(
              x,
              pmap.get(
                x.user_id
              )
            )
        ),

      doubts:
        doubts.map(
          x =>
            publicDoubt(
              x,
              pmap.get(
                x.user_id
              ),
              []
            )
        ),

      opportunities:
        opportunities.map(
          x =>
            publicOpportunity(
              x,
              pmap.get(
                x.user_id
              )
            )
        ),

      assignments:
        assignments.map(
          x =>
            publicAssignment(
              x,

              pmap.get(
                x.user_id
              ),

              pmap.get(
                x.worker_id
              ),

              (reworks || [])
                .filter(
                  r =>
                    r.assignment_id ===
                    x.id
                )
            )
        ),

      payments:
        payments,

      applications:
        applications,

      connections:
        connections,

      notifications:
        notifications
    });
  }

  /* =======================================================
     NOTIFICATIONS
  ======================================================= */

  if (
    p === "/api/notifications" &&
    method === "GET"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      data,
      error
    } =
      await supabase
        .from(
          "notifications"
        )
        .select("*")
        .eq(
          "user_id",
          user.id
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(100);

    if (error) {
      return json(res, 500, {
        error:
          error.message
      });
    }

    return json(res, 200, {
      notifications:
        data || []
    });
  }

  /* =======================================================
     NOTIFICATION READ
  ======================================================= */

  match =
    p.match(
      /^\/api\/notifications\/([^/]+)\/read$/
    );

  if (
    match &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    const {
      error
    } =
      await supabase
        .from(
          "notifications"
        )
        .update({
          read:
            true
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
      return json(res, 400, {
        error:
          error.message
      });
    }

    return json(res, 200, {
      ok:
        true
    });
  }

  /* =======================================================
     REPORTS
  ======================================================= */

  if (
    p === "/api/reports" &&
    method === "POST"
  ) {
    if (
      !requireUser(
        user,
        res
      )
    ) {
      return;
    }

    if (
      !body.targetType ||
      !body.reason
    ) {
      return json(res, 400, {
        error:
          "Target and reason are required."
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from(
          "reports"
        )
        .insert({
          reporter_id:
            user.id,

          target_type:
            body.targetType,

          target_id:
            body.targetId ||
            null,

          reason:
            String(
              body.reason
            ).trim()
        })
        .select("*")
        .single();

    if (error) {
      return json(res, 400, {
        error:
          error.message
      });
    }

    return json(res, 200, {
      report:
        data
    });
  }

  /* =======================================================
     UNKNOWN API
  ======================================================= */

  return json(res, 404, {
    error:
      "API route not found"
  });
}

/* =========================================================
   MIME TYPES
========================================================= */

function mime(file) {
  const ext =
    path.extname(
      file
    ).toLowerCase();

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
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}

/* =========================================================
   HTTP SERVER
========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {

        /*
          CORS preflight
        */

        if (
          req.method ===
          "OPTIONS"
        ) {
          res.writeHead(
            204,
            {
              "Access-Control-Allow-Origin":
                "*",

              "Access-Control-Allow-Headers":
                "Content-Type, Authorization",

              "Access-Control-Allow-Methods":
                "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            }
          );

          return res.end();
        }

        const u =
          new URL(
            req.url,
            `http://localhost:${PORT}`
          );

        /*
          API
        */

        if (
          u.pathname.startsWith(
            "/api/"
          )
        ) {
          return await api(
            req,
            res,
            u
          );
        }

        /*
          Uploaded files
        */

        if (
          u.pathname.startsWith(
            "/uploads/"
          )
        ) {
          const name =
            path.basename(
              u.pathname
            );

          const file =
            path.join(
              UPLOADS,
              name
            );

          if (
            !fs.existsSync(
              file
            )
          ) {
            return text(
              res,
              404,
              "Not found"
            );
          }

          res.writeHead(
            200,
            {
              "Content-Type":
                mime(file),

              "Cache-Control":
                "public, max-age=3600",

              "Access-Control-Allow-Origin":
                "*"
            }
          );

          return fs
            .createReadStream(
              file
            )
            .pipe(res);
        }

        /*
          Frontend
        */

        let file;

        if (
          u.pathname ===
          "/"
        ) {
          file =
            path.join(
              PUBLIC,
              "index.html"
            );
        } else {
          file =
            path.join(
              PUBLIC,
              path
                .normalize(
                  u.pathname
                )
                .replace(
                  /^[/\\]+/,
                  ""
                )
            );
        }

        /*
          Security:
          don't allow files outside public.
        */

        if (
          !file.startsWith(
            PUBLIC
          ) ||
          !fs.existsSync(
            file
          ) ||
          fs.statSync(
            file
          ).isDirectory()
        ) {
          file =
            path.join(
              PUBLIC,
              "index.html"
            );
        }

        if (
          !fs.existsSync(
            file
          )
        ) {
          return text(
            res,
            404,
            "public/index.html not found"
          );
        }

        res.writeHead(
          200,
          {
            "Content-Type":
              mime(file),

            "Cache-Control":
              "no-cache"
          }
        );

        return fs
          .createReadStream(
            file
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
          return json(
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
   START
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
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
      `PORT: ${PORT}`
    );
    console.log(
      "HOST: 0.0.0.0"
    );
    console.log(
      `PUBLIC: ${PUBLIC}`
    );
    console.log(
      "DATABASE: Supabase PostgreSQL"
    );
    console.log(
      "AUTH: Supabase Auth"
    );
    console.log(
      "=========================================="
    );
    console.log("");
  }
);


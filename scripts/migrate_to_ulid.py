#!/usr/bin/env python3
import os
import sys
import time
import secrets
import hashlib
from datetime import datetime, timedelta, timezone

# --- ULID Generation (Self-contained) ---
def generate_ulid_bytes() -> bytes:
    """
    Generate a 16-byte ULID-like identifier.
    48-bit timestamp (milliseconds) + 80-bit randomness.
    """
    timestamp = int(time.time() * 1000)
    # 6 bytes for timestamp
    t_bytes = timestamp.to_bytes(6, byteorder="big")
    # 10 bytes of randomness
    r_bytes = os.urandom(10)
    return t_bytes + r_bytes

# --- Migration Script ---
MARKER_FILE = ".migration_ulid_done"

def apply_schema(cur):
    """Attempt to apply schema.sql if tables are missing."""
    possible_paths = [
        "db/init/schema.sql",
        "../db/init/schema.sql",
        "/app/db/init/schema.sql"
    ]
    schema_path = None
    for p in possible_paths:
        if os.path.exists(p):
            schema_path = p
            break
    
    if not schema_path:
        print("Warning: db/init/schema.sql not found. Script will attempt to proceed but may fail.")
        return

    print(f"Applying/Verifying schema from {schema_path}...")
    with open(schema_path, "r") as f:
        content = f.read()
        # Simple splitter: split by semicolon, skip comments
        statements = []
        current_stmt = []
        for line in content.splitlines():
            clean_line = line.strip()
            if not clean_line or clean_line.startswith("--") or clean_line.startswith("#"):
                continue
            current_stmt.append(clean_line)
            if clean_line.endswith(";"):
                statements.append(" ".join(current_stmt))
                current_stmt = []
        
        for stmt in statements:
            try:
                cur.execute(stmt)
            except Exception:
                # Ignore common "already exists" errors since we use IF NOT EXISTS
                pass

def main():
    if os.path.exists(MARKER_FILE):
        print("Migration already completed (marker file exists).")
        return

    try:
        import pymysql
    except ImportError:
        print("Error: pymysql not found. Please run this in an environment with dependencies installed.")
        sys.exit(1)

    host = os.getenv("DB_HOST", "db")
    user = os.getenv("DB_USER", "appuser")
    password = os.getenv("DB_PASSWORD", "apppass")
    database = os.getenv("DB_NAME", "appdb")

    print(f"Connecting to {database} at {host}...")
    try:
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            autocommit=False
        )
    except Exception as e:
        print(f"Failed to connect to database: {e}")
        sys.exit(1)

    try:
        with conn.cursor() as cur:
            # 1. Bootstrapping: Ensure schema and admin user
            try:
                cur.execute("SELECT id, username, global_role FROM users")
                users_rows = cur.fetchall()
            except (pymysql.err.ProgrammingError, pymysql.err.InternalError) as e:
                # Error 1146 = Table doesn't exist
                if "1146" in str(e):
                    apply_schema(cur)
                    try:
                        cur.execute("SELECT id, username, global_role FROM users")
                        users_rows = cur.fetchall()
                    except Exception:
                        users_rows = []
                else:
                    raise

            if len(users_rows) == 0:
                print("No users found. Bootstrapping initial admin user...")
                admin_id_bin = generate_ulid_bytes()
                cur.execute(
                    "INSERT INTO users (id, username, password_hash, global_role) VALUES (%s, %s, %s, %s)",
                    (admin_id_bin, 'admin', 'bootstrap-placeholder', 'admin')
                )
                users_rows = [(admin_id_bin, 'admin', 'admin')]
            
            if len(users_rows) > 1:
                print(f"Error: Found {len(users_rows)} users. Migration requires a single-user (admin) state for safety.")
                sys.exit(1)
            
            admin_id_old, admin_username, admin_role = users_rows[0]
            if admin_role != 'admin':
                print(f"Error: Existing user '{admin_username}' is not an admin.")
                sys.exit(1)

            print(f"Verified admin context: {admin_username}")

            # 2. Collect IDs and generate new ULIDs
            tables_to_migrate = [
                'users', 'locations', 'plants', 'plants_measurements', 
                'plants_events', 'devices', 'auth_refresh_tokens'
            ]
            mappings = {table: {} for table in tables_to_migrate}

            for table in tables_to_migrate:
                try:
                    cur.execute(f"SELECT id FROM {table}")
                    for (old_id,) in cur.fetchall():
                        mappings[table][old_id] = generate_ulid_bytes()
                    print(f"Mapped {len(mappings[table])} IDs for {table}")
                except Exception:
                    # Table might not exist if it's a new one and schema.sql failed/was missing
                    continue

            # 3. Perform migration with FK checks disabled
            cur.execute("SET FOREIGN_KEY_CHECKS = 0")

            # A. Update Primary Keys
            for table, mapping in mappings.items():
                for old_id, new_id in mapping.items():
                    cur.execute(f"UPDATE {table} SET id = %s WHERE id = %s", (new_id, old_id))
            
            # B. Update Foreign Keys (Ripple)
            admin_id_new = mappings['users'].get(admin_id_old, admin_id_old)
            
            fk_updates = [
                ('invite_tokens', 'user_id', 'users'),
                ('user_totp_secrets', 'user_id', 'users'),
                ('user_recovery_codes', 'user_id', 'users'),
                ('user_devices', 'user_id', 'users'),
                ('auth_refresh_tokens', 'user_id', 'users'),
                ('user_location_acl', 'user_id', 'users'),
                ('plants', 'owner_id', 'users'),
                # Locations references
                ('user_location_acl', 'location_id', 'locations'),
                ('plants', 'location_id', 'locations'),
                ('plants_events', 'related_location_id', 'locations'),
                # Plants references
                ('plants_measurements', 'plant_id', 'plants'),
                ('plants_events', 'plant_id', 'plants'),
                # Devices references
                ('user_devices', 'device_id', 'devices'),
                ('auth_refresh_tokens', 'device_id', 'devices'),
                # Tokens references
                ('auth_refresh_tokens', 'rotated_from_id', 'auth_refresh_tokens'),
            ]

            for table, col, ref_table in fk_updates:
                if ref_table not in mappings or not mappings[ref_table]:
                    continue
                
                # Check if table and column exist to avoid "Unknown column" or "Table not found" error
                try:
                    cur.execute(f"SELECT {col} FROM {table} LIMIT 0")
                except pymysql.err.OperationalError as e:
                    if e.args[0] in (1054, 1146): # 1054: Unknown column, 1146: Table doesn't exist
                        print(f"Skipping update for {table}.{col} (not found)")
                        continue
                    raise

                for old_id, new_id in mappings[ref_table].items():
                    cur.execute(f"UPDATE {table} SET {col} = %s WHERE {col} = %s", (new_id, old_id))

            # 4. Backfill user_location_acl
            # Clear existing ACL for clean slate if migrating from old ownership
            try:
                cur.execute("DELETE FROM user_location_acl")
                for loc_id_new in mappings['locations'].values():
                    cur.execute(
                        "INSERT INTO user_location_acl (user_id, location_id, role) VALUES (%s, %s, 'owner')",
                        (admin_id_new, loc_id_new)
                    )
                print(f"Backfilled ACL for {len(mappings['locations'])} locations to admin.")
            except pymysql.err.OperationalError as e:
                if e.args[0] == 1146:
                    print("Skipping user_location_acl backfill (table not found).")
                else:
                    raise

            # 5. Clear legacy plants.owner_id (if exists)
            try:
                cur.execute("UPDATE plants SET owner_id = NULL")
                print("Cleared legacy plants.owner_id.")
            except pymysql.err.OperationalError as e:
                if e.args[0] == 1054: # Unknown column
                    print("Skipping legacy plants.owner_id clearing (column not found).")
                else:
                    raise

            # 6. Generate one-time admin login link (Invite Token)
            raw_token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(raw_token.encode()).digest()
            expires_at = datetime.now(timezone.utc) + timedelta(days=7)
            
            cur.execute(
                "INSERT INTO invite_tokens (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
                (token_hash, admin_id_new, expires_at)
            )

            # 7. Finalize
            cur.execute("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
            
            with open(MARKER_FILE, "w") as f:
                f.write(f"Migration completed at {datetime.now(timezone.utc).isoformat()}\n")
            
            print("\nMigration successful!")
            print("================================================================")
            print(f"One-time admin login link (Expires in 7 days):")
            print(f"/invite/complete?token={raw_token}")
            print("================================================================")

    except Exception as e:
        conn.rollback()
        print(f"\nMigration failed: {e}")
        # Print stack trace for debugging if it's an unexpected error
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    main()

// Dog NFT Minter (simplified) in Tact
// - Admin-only minting of dog NFTs with off-chain metadata (JSON string)
// - Stores: nextId, admin, mapping id -> { owner, metadata }
// - Get methods: get_next_id, get_token
//
// NOTE: This is a minimal educational contract and not a full TIP-4 NFT implementation.
//       It does not support transfers or royalties; it simply records mints on-chain.

struct Token {
    owner: Address;
    metadata: Cell; // stores UTF-8 JSON string as a cell
}

struct TokenOut {
    owner: Address;
    metadata: Cell;
}

contract DogNftMinter {
    // Storage
    owner: Address;        // admin allowed to mint
    nextId: Int;           // next token id to assign

    // tokenId => (owner, metadata)
    tokens: map<Int, Token>;

    init(owner: Address) {
        self.owner = owner;
        self.nextId = 0;
        // tokens map defaults to empty
    }

    // Opcodes
    // Using 0x4D494E54 = 'MINT'
    const OP_MINT: Int = 0x4D494E54;

    // Mint message layout (internal):
    // uint32 op (OP_MINT)
    // uint64 query_id
    // address newOwner
    // ref: metadataCell (string stored via storeStringTail)
    // Only the admin `owner` is allowed to mint.
    receive(msg: Slice) {
        // Authorization: only admin can send OP_MINT
        require(sender() == self.owner, "forbidden");

        let body = msg;
        if (body.loadUint(32) == self.OP_MINT) {
            // skip query_id
            let _qid = body.loadUint(64);
            let newOwner = body.loadAddress();
            let mdCell = body.loadRef();
            let metadata = mdCell;

            let id = self.nextId;
            self.tokens.set(id, Token{ owner: newOwner, metadata: metadata });
            self.nextId = id + 1;
        }
    }

    // Get methods
    get fun get_next_id(): Int {
        return self.nextId;
    }

    get fun get_token(id: Int): TokenOut {
        let tok = self.tokens.get(id);
        require(tok != null, "not_found");
        return TokenOut{ owner: tok!!.owner, metadata: tok!!.metadata };
    }
}
